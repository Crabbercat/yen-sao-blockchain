\getenv app_user APP_DB_USER
\getenv app_password APP_DB_PASSWORD
\getenv app_database POSTGRES_DB

CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password';
GRANT CONNECT, CREATE ON DATABASE :"app_database" TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
