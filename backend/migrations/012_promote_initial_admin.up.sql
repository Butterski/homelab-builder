-- Replace 'your-admin-email@example.com' with the email address of the user who should be the admin
-- Only run this if the user already exists in the database
UPDATE users 
SET is_admin = true 
WHERE email = 'your-admin-email@example.com';
