import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAllUsersWithStats } from "@/lib/db/repos/users.repo";

function toSafeUser(u: {
  id: string;
  email: string | null;
  phoneNumber: string | null;
  fullName: string | null;
  role: string;
  disabled: boolean;
  createdAt: string;
  orderCount: number;
  totalSpentCents: number;
}) {
  return {
    id: u.id,
    email: u.email,
    phoneNumber: u.phoneNumber,
    fullName: u.fullName,
    role: u.role,
    disabled: u.disabled,
    createdAt: u.createdAt,
    orderCount: u.orderCount,
    totalSpentCents: u.totalSpentCents,
  };
}

export const GET = withRoute({ permission: "users.read", rateLimit: RateLimitRules.adminGeneral }, async ({ req }) => {
  const page = Number(req.nextUrl.searchParams.get("page")) || 1;
  const pageSize = Number(req.nextUrl.searchParams.get("pageSize")) || 25;
  const { users, total } = await listAllUsersWithStats({ page, pageSize });
  return json({ users: users.map(toSafeUser), total, page, pageSize });
});
