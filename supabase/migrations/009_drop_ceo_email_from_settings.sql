-- CEO email is now sourced from the CEO_EMAIL environment variable
ALTER TABLE settings DROP COLUMN ceo_email;
