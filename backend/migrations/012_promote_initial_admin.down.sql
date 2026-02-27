-- Revert the admin promotion
UPDATE users 
SET is_admin = false 
WHERE email = 'your-admin-email@example.com';
