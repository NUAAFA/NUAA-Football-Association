import { RefereeServiceError } from "@/lib/referee-service-error";

// This existing, immutable login owns the system. SUPER_ADMIN is delegable;
// ownership is deliberately not a role that another administrator can assign.
export const protectedAdminUsername = "nuaafa";

export function isProtectedAdminAccount(account: { username: string }) {
  return account.username === protectedAdminUsername;
}

export function assertAdminAccountMutable(account: { username: string }) {
  if (isProtectedAdminAccount(account)) {
    throw new RefereeServiceError("最高管理员账号受保护，不能修改其角色、状态、重置密码或删除；本人可通过个人菜单修改密码。", 403);
  }
}

export function assertAdminUsernameAvailable(username: string) {
  if (username === protectedAdminUsername) {
    throw new RefereeServiceError("最高管理员账号为系统保留账号，不能通过账号管理创建。", 403);
  }
}
