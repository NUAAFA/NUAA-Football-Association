export function activeAdminHref(pathname: string, items: readonly { href: string; exact?: boolean }[]) {
  return items.filter(({ href, exact }) => exact || href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
