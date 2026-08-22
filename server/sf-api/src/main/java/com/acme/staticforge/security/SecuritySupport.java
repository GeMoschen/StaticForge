package com.acme.staticforge.security;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * Convenience access to the current {@link AuthenticatedUser}. Controllers use this to
 * obtain the acting user id for {@code RevisionContext}.
 */
@Component
public class SecuritySupport {

    public AuthenticatedUser requireUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthenticatedUser user) {
            return user;
        }
        throw new SfException(ProblemFactory.unauthorized("Authentication required."));
    }

    public Long currentUserId() {
        return requireUser().id();
    }
}
