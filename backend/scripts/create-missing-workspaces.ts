import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // 1. List all auth users
  const { data: usersData, error: usersError } =
    await supabase.auth.admin.listUsers();

  if (usersError) {
    console.error("Failed to list users:", usersError.message);
    process.exit(1);
  }

  const users = usersData.users;
  console.log(`Found ${users.length} user(s) in auth.users`);

  // 2. Get all existing workspace owner_ids
  const { data: workspaces, error: wsError } = await supabase
    .from("workspace")
    .select("owner_id");

  if (wsError) {
    console.error("Failed to list workspaces:", wsError.message);
    process.exit(1);
  }

  const existingOwners = new Set(workspaces.map((w) => w.owner_id));

  // 3. Find users without a workspace
  const missing = users.filter((u) => !existingOwners.has(u.id));
  console.log(`${missing.length} user(s) without a workspace`);

  if (missing.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // 4. Create workspaces
  for (const user of missing) {
    const emailPrefix = user.email?.split("@")[0] ?? user.id;
    let baseSlug = emailPrefix
      .replace(/[^a-z0-9]/gi, "-")
      .toLowerCase()
      .replace(/^-+|-+$/g, "");

    if (!baseSlug) baseSlug = user.id;

    // Handle slug collisions
    let slug = baseSlug;
    let suffix = 0;
    while (true) {
      const { count } = await supabase
        .from("workspace")
        .select("*", { count: "exact", head: true })
        .eq("slug", slug);

      if ((count ?? 0) === 0) break;
      suffix++;
      slug = `${baseSlug}-${suffix}`;
    }

    const { error: insertError } = await supabase.from("workspace").insert({
      name: "Mon espace",
      slug,
      owner_id: user.id,
    });

    if (insertError) {
      console.error(`Failed for ${user.email ?? user.id}:`, insertError.message);
    } else {
      console.log(`Created workspace "${slug}" for ${user.email ?? user.id}`);
    }
  }

  console.log("Done.");
}

main();
