'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, Avatar, Button, Spin, Empty, message } from 'antd';
import { PlusOutlined, LoadingOutlined } from '@ant-design/icons';
import Navbar from '../../components/navbar';
import PlantCard from '../../components/plantCard';
import AddPlantModal from '../../components/addPlantModal';
import styles from '../../styles/dashboard.module.css';

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/signin');
    }

    if (status === 'authenticated') {
      fetchPlants();
    }
  }, [status, router]);

  const fetchPlants = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/plants');
      
      if (!response.ok) {
        if (response.status === 401) {
          message.error('Session expired. Please sign in again.');
          router.push('/signin');
          return;
        }
        throw new Error('Failed to fetch plants');
      }

      const data = await response.json();
      setPlants(data.plants || []);
    } catch (error) {
      console.error('Error fetching plants:', error);
      message.error('Failed to load plant profiles');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

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

        <Card 
          title="Plant Profiles" 
          className={styles.plantsSection}
          extra={
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => setShowAddModal(true)}
            >
              Add Plant
            </Button>
          }
        >
          {loading ? (
            <div className={styles.loadingSection}>
              <Spin size="large" indicator={<LoadingOutlined spin />} />
              <p>Loading plant profiles...</p>
            </div>
          ) : plants.length === 0 ? (
            <Empty 
              description="No plant profiles yet"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setShowAddModal(true)}
              >
                Add Your First Plant
              </Button>
            </Empty>
          ) : (
            <div className={styles.plantsGrid}>
              {plants.map((plant) => (
                <PlantCard key={plant._id} plant={plant} />
              ))}
            </div>
          )}
        </Card>

        {/* Add Plant Modal */}
        <AddPlantModal
          visible={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSuccess={fetchPlants}
        />
      </main>
    </div>
  );
}