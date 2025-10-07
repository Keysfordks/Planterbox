import { redirect } from 'next/navigation';
import { auth } from '../api/auth/[...nextauth]/route';
import { Card, Avatar, Button, Statistic, Timeline } from 'antd';
import { 
  FolderOutlined, 
  CheckCircleOutlined, 
  ClockCircleOutlined,
  PlusOutlined,
  UserAddOutlined,
  BarChartOutlined,
  RiseOutlined
} from '@ant-design/icons';
import Navbar from '../../components/navbar';
import styles from '../../styles/dashboard.module.css';

export default async function DashboardPage() {
  const session = await auth();

  if (!session) {
    redirect('/signin');
  }

  const activities = [
    { 
      color: 'green',
      children: (
        <>
          <p className={styles.activityTitle}>Completed task</p>
          <p className={styles.activityDesc}>Design homepage mockup</p>
          <p className={styles.activityTime}>2 hours ago</p>
        </>
      )
    },
    { 
      color: 'blue',
      children: (
        <>
          <p className={styles.activityTitle}>Started project</p>
          <p className={styles.activityDesc}>Mobile app development</p>
          <p className={styles.activityTime}>5 hours ago</p>
        </>
      )
    },
    { 
      color: 'purple',
      children: (
        <>
          <p className={styles.activityTitle}>Updated milestone</p>
          <p className={styles.activityDesc}>Q4 Planning</p>
          <p className={styles.activityTime}>1 day ago</p>
        </>
      )
    },
    { 
      color: 'gray',
      children: (
        <>
          <p className={styles.activityTitle}>Added team member</p>
          <p className={styles.activityDesc}>Sarah Johnson</p>
          <p className={styles.activityTime}>2 days ago</p>
        </>
      )
    },
  ];

  return (
    <div className={styles.container}>
      <Navbar session={session} />

      <main className={styles.main}>
        <Card className={styles.welcomeCard}>
          <div className={styles.welcomeContent}>
            <Avatar 
              src={session.user?.image} 
              size={64}
              className={styles.avatar}
            />
            <div>
              <h2 className={styles.welcomeTitle}>
                Welcome back, {session.user?.name || 'User'}!
              </h2>
              <p className={styles.welcomeEmail}>{session.user?.email}</p>
            </div>
          </div>
        </Card>

        <div className={styles.statsGrid}>
          <Card>
            <Statistic
              title="Total Projects"
              value={12}
              prefix={<FolderOutlined />}
              suffix={
                <span className={styles.statSuffix}>
                  <RiseOutlined /> 3 new
                </span>
              }
            />
          </Card>

          <Card>
            <Statistic
              title="Tasks Completed"
              value={48}
              prefix={<CheckCircleOutlined />}
              suffix={
                <span className={styles.statSuffix}>
                  <RiseOutlined /> 85%
                </span>
              }
            />
          </Card>

          <Card>
            <Statistic
              title="Hours Logged"
              value={127}
              prefix={<ClockCircleOutlined />}
              suffix={
                <span className={styles.statSuffix}>
                  <RiseOutlined /> 12%
                </span>
              }
            />
          </Card>
        </div>

        <div className={styles.contentGrid}>
          <Card title="Recent Activity" className={styles.card}>
            <Timeline items={activities} />
          </Card>

          <Card title="Quick Actions" className={styles.card}>
            <div className={styles.actionsList}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />} 
                size="large"
                block
                className={styles.actionButton}
              >
                Create New Project
              </Button>
              <Button 
                icon={<PlusOutlined />} 
                size="large"
                block
                className={styles.actionButton}
              >
                Add Task
              </Button>
              <Button 
                icon={<UserAddOutlined />} 
                size="large"
                block
                className={styles.actionButton}
              >
                Invite Team Member
              </Button>
              <Button 
                icon={<BarChartOutlined />} 
                size="large"
                block
                className={styles.actionButton}
              >
                View Reports
              </Button>
            </div>
          </Card>
        </div>

        <Card title="Account Information" className={styles.accountCard}>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Name</p>
              <p className={styles.infoValue}>{session.user?.name || 'Not provided'}</p>
            </div>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Email</p>
              <p className={styles.infoValue}>{session.user?.email || 'Not provided'}</p>
            </div>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Account Type</p>
              <p className={styles.infoValue}>Google OAuth</p>
            </div>
            <div className={styles.infoItem}>
              <p className={styles.infoLabel}>Member Since</p>
              <p className={styles.infoValue}>October 2024</p>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}