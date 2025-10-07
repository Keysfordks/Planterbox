import Link from 'next/link';
import { Button, Card } from 'antd';
import { CheckCircleOutlined, SafetyOutlined, ThunderboltOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { auth } from './api/auth/[...nextauth]/route';
import Navbar from '../components/navbar';
import styles from '../styles/home.module.css';

export default async function HomePage() {
  const session = await auth();

  const features = [
    {
      icon: <CheckCircleOutlined />,
      title: 'Easy to Use',
      description: 'Simple and intuitive interface for everyone.',
    },
    {
      icon: <SafetyOutlined />,
      title: 'Secure',
      description: 'Your data is protected with OAuth authentication.',
    },
    {
      icon: <ThunderboltOutlined />,
      title: 'Fast',
      description: 'Lightning-fast performance and real-time updates.',
    },
  ];

  return (
    <div className={styles.container}>
      <Navbar session={session} />

      <main className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.heroTitle}>
            Welcome to <span className={styles.heroTitleAccent}>PlanterBox</span>
          </h1>
          <p className={styles.heroDescription}>
            Your personal dashboard for managing projects, tracking progress, and staying organized.
          </p>
          
          <div className={styles.ctaContainer}>
            {!session ? (
              <Link href="/signin">
                <Button type="primary" size="large" icon={<ArrowRightOutlined />} className={styles.ctaButton}>
                  Get Started
                </Button>
              </Link>
            ) : (
              <Link href="/dashboard">
                <Button type="primary" size="large" icon={<ArrowRightOutlined />} className={styles.ctaButton}>
                  Go to Dashboard
                </Button>
              </Link>
            )}
          </div>

          <div className={styles.features}>
            {features.map((feature, index) => (
              <Card key={index} className={styles.featureCard}>
                <div className={styles.featureIcon}>{feature.icon}</div>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureDescription}>{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}