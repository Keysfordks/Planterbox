'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Alert, Typography } from 'antd';
import { GoogleOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import styles from '../../styles/signin.module.css';

const { Title, Text } = Typography;

export default function SignInPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const getErrorMessage = (errorCode) => {
    const errors = {
      OAuthSignin: 'Error connecting to Google. Please try again.',
      OAuthCallback: 'Error during sign in. Please try again.',
      OAuthCreateAccount: 'Could not create account. Please try again.',
      EmailCreateAccount: 'Could not create account. Please try again.',
      Callback: 'Error during sign in. Please try again.',
      OAuthAccountNotLinked: 'Account already exists with different provider.',
      EmailSignin: 'Check your email for the sign in link.',
      CredentialsSignin: 'Sign in failed. Check your credentials.',
      SessionRequired: 'Please sign in to access this page.',
    };
    return errors[errorCode] || 'An error occurred. Please try again.';
  };

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <Link href="/" className={styles.logo}>
            PlanterBox
          </Link>
          <Text className={styles.subtitle}>Sign in to your account</Text>
        </div>

        <Card className={styles.card}>
          {error && (
            <Alert
              message="Sign In Error"
              description={getErrorMessage(error)}
              type="error"
              showIcon
              closable
              style={{ marginBottom: '1.5rem' }}
            />
          )}

          <Button
            type="primary"
            size="large"
            icon={<GoogleOutlined />}
            onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
            block
            className={styles.googleButton}
          >
            Continue with Google
          </Button>

          <Text type="secondary" className={styles.terms}>
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </Text>
        </Card>

        <div className={styles.backLink}>
          <Link href="/">
            <Button type="link" icon={<ArrowLeftOutlined />} className={styles.backButton}>
              Back to home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}