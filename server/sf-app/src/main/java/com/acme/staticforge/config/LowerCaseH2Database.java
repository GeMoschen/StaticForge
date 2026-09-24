package com.acme.staticforge.config;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import liquibase.CatalogAndSchema;
import liquibase.Scope;
import liquibase.database.DatabaseConnection;
import liquibase.database.core.H2Database;
import liquibase.database.jvm.JdbcConnection;

/**
 * Liquibase's {@link H2Database} with support for H2's {@code DATABASE_TO_LOWER=TRUE}, which every profile uses
 * (spec §22.3). Liquibase assumes H2 folds unquoted identifiers to upper case and looks its own tables up as
 * {@code DATABASECHANGELOG}, while H2 created them as {@code databasechangelog}. It then misses the history
 * table (and the upper-cased catalog) of an existing database and fails recreating the table, so a file-based
 * database could only start once. This variant folds object, catalog and schema names to lower case instead.
 * Registered through {@code META-INF/services/liquibase.database.Database}; outranks the stock implementation.
 */
public class LowerCaseH2Database extends H2Database {

    private static final String DATABASE_TO_LOWER_QUERY =
            "SELECT SETTING_VALUE FROM INFORMATION_SCHEMA.SETTINGS WHERE SETTING_NAME = 'DATABASE_TO_LOWER'";

    private boolean lowerCase;

    @Override
    public int getPriority() {
        return super.getPriority() + 1;
    }

    @Override
    public void setConnection(DatabaseConnection conn) {
        super.setConnection(conn);
        lowerCase = conn instanceof JdbcConnection jdbc && foldsToLowerCase(jdbc.getUnderlyingConnection());
        if (lowerCase) {
            unquotedObjectsAreUppercased = Boolean.FALSE;
        }
    }

    @Override
    public CatalogAndSchema.CatalogAndSchemaCase getSchemaAndCatalogCase() {
        return lowerCase ? CatalogAndSchema.CatalogAndSchemaCase.LOWER_CASE : super.getSchemaAndCatalogCase();
    }

    private static boolean foldsToLowerCase(Connection connection) {
        try (Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(DATABASE_TO_LOWER_QUERY)) {
            return result.next() && Boolean.parseBoolean(result.getString(1));
        } catch (SQLException e) {
            Scope.getCurrentScope()
                    .getLog(LowerCaseH2Database.class)
                    .info("Could not read H2 setting DATABASE_TO_LOWER: " + e.getMessage());
            return false;
        }
    }
}
