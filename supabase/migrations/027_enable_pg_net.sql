-- Needed to call the render service from the database, both for the wake-up
-- poke and for the gallery database webhook.
create extension if not exists pg_net;
