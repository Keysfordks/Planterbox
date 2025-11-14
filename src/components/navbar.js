"use client";

import { Button } from "antd";
import { DashboardOutlined } from "@ant-design/icons";
import Link from "next/link";
import styles from "../styles/navbar.module.css";

export default function Navbar() {
  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <Link href="/dashboard" className={styles.logo}>
          Automated Plant Care System
        </Link>
        <div className={styles.navRight}>
          <Link href="/dashboard">
            <Button type="primary" size="large" icon={<DashboardOutlined />}>
              Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  );
}