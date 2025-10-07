"use client";

import { Avatar, Dropdown, Button } from "antd";
import {
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
} from "@ant-design/icons";
import { signOut } from "next-auth/react";
import Link from "next/link";
import styles from "../styles/navbar.module.css";

export default function Navbar({ session }) {
  const menuItems = [
    {
      key: "dashboard",
      icon: <DashboardOutlined />,
      label: <Link href="/dashboard">Dashboard</Link>,
    },
    {
      type: "divider",
    },
    {
      key: "signout",
      icon: <LogoutOutlined />,
      label: "Sign Out",
      onClick: () => signOut({ callbackUrl: "/" }),
      danger: true,
    },
  ];

  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.logo}>
          PlanterBox
        </Link>
        <div className={styles.navRight}>
          {session ? (
            <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
              <div className={styles.userInfo}>
                <Avatar
                  src={session.user?.image}
                  icon={!session.user?.image && <UserOutlined />}
                  className={styles.avatar}
                />
                <span className={styles.userName}>{session.user?.name}</span>
              </div>
            </Dropdown>
          ) : (
            <Link href="/signin">
              <Button type="primary" size="large">
                Sign In
              </Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
