"use client";

import { KeyRound, LogOut, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { logoutUserAction } from "@/app/account/actions";

type HeaderUserMenuProps = {
  user:
    | {
        displayName: string;
        avatarPath: string | null;
      }
    | null;
  loginEnabled: boolean;
  registrationEnabled: boolean;
};

export function HeaderUserMenu({ user, loginEnabled, registrationEnabled }: HeaderUserMenuProps) {
  const [open, setOpen] = useState(false);

  if (!user && !loginEnabled && !registrationEnabled) {
    return null;
  }

  return (
    <div
      className="userMenu"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (!event.currentTarget.contains(nextTarget)) {
        setOpen(false);
      }
      }}
    >
      <button
        className="iconLink userIconLink"
        type="button"
        aria-label={user ? "用户菜单" : "登录菜单"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {user?.avatarPath ? <img src={user.avatarPath} alt="" /> : <UserRound size={21} aria-hidden="true" />}
      </button>
      {open ? (
        <div className="userMenuPanel">
          {user ? (
            <>
              <Link href="/account" onClick={() => setOpen(false)}>
                <UserRound size={16} aria-hidden="true" />
                用户中心
              </Link>
              <form action={logoutUserAction}>
                <button type="submit">
                  <LogOut size={16} aria-hidden="true" />
                  退出登录
                </button>
              </form>
            </>
          ) : (
            <>
              {loginEnabled ? (
                <Link href="/login" onClick={() => setOpen(false)}>
                  <KeyRound size={16} aria-hidden="true" />
                  登录
                </Link>
              ) : null}
              {registrationEnabled ? (
                <Link href="/register" onClick={() => setOpen(false)}>
                  <UserPlus size={16} aria-hidden="true" />
                  注册
                </Link>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
