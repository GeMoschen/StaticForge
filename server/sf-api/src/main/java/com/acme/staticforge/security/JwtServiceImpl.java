package com.acme.staticforge.security;

import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

/**
 * HS256 access-token issuer (spec §9.2, §9.3). Project memberships are resolved from the
 * {@link ProjectMemberRepository}/{@link ProjectRepository} and embedded as the {@code
 * projects} claim so authorization is O(1) per request. Every claim, the {@code epoch} included, is read from the
 * account's current row rather than from the passed entity: a token that carried an epoch older than the database
 * (e.g. after a membership change bumped it) would be rejected on its first use.
 *
 * <p>TODO(spec §9.3): RS256 + JWKS + two-key rotation is a documented follow-up. This class
 * (and {@link SecurityConfig}'s {@code JwtDecoder}) only implement HS256; the {@code
 * algorithm} property is read but RS256 is not yet wired in code.
 */
@Component
public class JwtServiceImpl implements JwtService {

    private final JwtEncoder encoder;
    private final JwtProperties properties;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectRepository projectRepository;
    private final AppUserRepository userRepository;
    private final Clock clock;

    public JwtServiceImpl(
            JwtEncoder encoder,
            JwtProperties properties,
            ProjectMemberRepository projectMemberRepository,
            ProjectRepository projectRepository,
            AppUserRepository userRepository,
            Clock clock) {
        this.encoder = encoder;
        this.properties = properties;
        this.projectMemberRepository = projectMemberRepository;
        this.projectRepository = projectRepository;
        this.userRepository = userRepository;
        this.clock = clock;
    }

    @Override
    public String issueAccessToken(AppUser account) {
        AppUser user = userRepository.findById(account.getId()).orElse(account);
        Instant now = clock.instant();
        Map<String, String> projects = new LinkedHashMap<>();
        resolveProjectRoles(user.getId())
                .forEach((key, role) -> projects.put(key, role.name()));

        String displayName = user.getDisplayName() != null ? user.getDisplayName() : user.getUsername();

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(properties.getIssuer())
                .subject(user.getId().toString())
                .id(UUID.randomUUID().toString())
                .issuedAt(now)
                .expiresAt(now.plus(properties.getAccessTokenTtl()))
                .claim("uid", user.getId())
                .claim("preferred_username", user.getUsername())
                .claim("name", displayName)
                .claim("sysRole", user.getSystemRole().name())
                .claim("projects", projects)
                .claim("epoch", user.getTokenEpoch())
                .build();

        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims))
                .getTokenValue();
    }

    private Map<String, ProjectRole> resolveProjectRoles(Long userId) {
        List<ProjectMember> members = projectMemberRepository.findByUserId(userId);
        if (members.isEmpty()) {
            return Map.of();
        }
        Set<Long> projectIds =
                members.stream().map(ProjectMember::getProjectId).collect(Collectors.toSet());
        // An archived project is hidden from its members (M26): it isn't in the claim, so every project endpoint
        // answers 404 like for a non-member. Instance admins don't need the claim to reach it.
        Map<Long, String> keysById = projectRepository.findAllById(projectIds).stream()
                .filter(project -> !project.isArchived())
                .collect(Collectors.toMap(Project::getId, Project::getKey, (a, b) -> a));

        Map<String, ProjectRole> roles = new LinkedHashMap<>();
        for (ProjectMember member : members) {
            String key = keysById.get(member.getProjectId());
            if (key != null) {
                roles.put(key, member.getRole());
            }
        }
        return roles;
    }
}
