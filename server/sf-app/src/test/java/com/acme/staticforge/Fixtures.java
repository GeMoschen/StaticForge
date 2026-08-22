package com.acme.staticforge;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Fixture builders for tests (spec §25.3). Every builder routes through the real
 * services so fixtures exercise the revision machinery rather than bypassing it.
 */
public class Fixtures {

    private final UserService users;
    private final ProjectService projects;
    private final AssetService assets;
    private final ObjectMapper mapper = new ObjectMapper();

    public Fixtures(UserService users, ProjectService projects, AssetService assets) {
        this.users = users;
        this.projects = projects;
        this.assets = assets;
    }

    public AppUser user(String username) {
        return users.create(username, username + "@example.com", username, "password-1234");
    }

    public Project project(String key, AppUser creator) {
        return projects.create(new CreateProjectRequest(key, key, null, "fixture"), creator.getId());
    }

    public AssetVersionView folder(Project project, AppUser actor, String name) {
        ObjectNode payload = mapper.createObjectNode();
        return assets.create(
                new CreateAssetCommand(project.getId(), AssetType.FOLDER, name, null, payload, null),
                ctx(project, actor, "fixture"));
    }

    public RevisionContext ctx(Project project, AppUser actor, String comment) {
        return RevisionContext.of(project.getId(), actor.getId(), comment);
    }
}
