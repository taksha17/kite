export type UserRole = "owner" | "accountant" | "data_entry";

export type Permission =
  | "manage_users"
  | "manage_company"
  | "manage_ledgers"
  | "manage_inventory"
  | "create_voucher"
  | "view_reports"
  | "view_audit";

const ROLE_PERMS: Record<UserRole, Permission[]> = {
  owner: [
    "manage_users",
    "manage_company",
    "manage_ledgers",
    "manage_inventory",
    "create_voucher",
    "view_reports",
    "view_audit",
  ],
  accountant: [
    "manage_company",
    "manage_ledgers",
    "manage_inventory",
    "create_voucher",
    "view_reports",
    "view_audit",
  ],
  data_entry: ["create_voucher", "view_reports"],
};

export function can(role: UserRole | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMS[role].includes(perm);
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "accountant":
      return "Accountant";
    case "data_entry":
      return "Data Entry";
  }
}
