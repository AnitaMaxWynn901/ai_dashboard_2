const bcrypt = require("bcrypt");
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function createUsers() {
  const password = "admin123"; // change later
  const hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase.from("users").insert([
    {
      username: "superadmin",
      password_hash: hash,
      role: "super-admin"
    }
  ]);

  if (error) {
    console.error("Failed to create user:", error.message);
  } else {
    console.log("Users created");
  }

  process.exit();
}

createUsers();