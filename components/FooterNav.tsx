"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  isActive: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: "🏠",
    isActive: (pathname) => pathname === "/",
  },
  {
    href: "/tours",
    label: "Tours",
    icon: "🚌",
    isActive: (pathname) => pathname === "/tours" || pathname.startsWith("/tours/"),
  },
  {
    href: "/bands",
    label: "Bands",
    icon: "🎸",
    isActive: (pathname) => pathname === "/bands" || pathname.startsWith("/bands/"),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: "👤",
    isActive: (pathname) => pathname === "/profile" || pathname.startsWith("/profile/"),
  },
];

export default function FooterNav() {
  const pathname = usePathname();

  return (
    <nav className="ts-nav fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md">
      <div className="mx-auto grid max-w-5xl grid-cols-4 gap-2 px-2 py-2">
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "ts-nav-item flex min-h-14 flex-col items-center justify-center rounded-md px-1 py-2 text-xs transition",
                active ? "ts-nav-item-active" : "",
              ].join(" ")}
            >
              <span aria-hidden="true" className="text-base leading-none">
                {item.icon}
              </span>
              <span className="mt-1">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
