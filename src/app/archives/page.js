'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, Spin, List, Typography, Button, Alert, message, Modal } from 'antd';
import { HistoryOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import Navbar from '../../../components/navbar'; 
import styles from '../../../styles/dashboard.module.css';

const { Title, Text } = Typography;
const { confirm } = Modal;

export default function ArchivesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);

  const fetchArchives = async () => {
    if (status !== 'authenticated') return;
    setLoading(true);
    try {
      const response = await fetch('/api/archives');
      if (!response.ok) throw new Error('Failed to fetch archives');
      const data = await response.json();
      setProjects(data.projects);
    } catch (error) {
      console.error('Error fetching archives:', error);
      message.error('Failed to load archived projects.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/signin');
      return;
    }
    fetchArchives();
  }, [status, router]);

  const handleDelete = (projectId, plantName) => {
    confirm({
      title: `Are you sure you want to delete the archive for ${plantName}?`,
      content: 'This action cannot be undone and will permanently remove all project metadata.',
      okText: 'Yes, Delete',
      okType: 'danger',
      cancelText: 'No',
      async onOk() {
        try {
          // Use the DELETE method on the archives API route
          const response = await fetch(`/api/archives?projectId=${projectId}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Failed to delete project');
          message.success(`${plantName} archive deleted.`);
          fetchArchives(); // Refresh the list
        } catch (error) {
          message.error('Error deleting project.');
        }
      },
    });
  };

  if (status === 'loading' || loading) {
    return <Spin size="large" className={styles.loadingContainer} />;
  }

  return (
    <div className={styles.container}>
      <Navbar session={session} />
      <main className={styles.main}>
        <Card title={
          <Title level={2} style={{ margin: 0 }}>
            <HistoryOutlined /> Past Grow Projects
          </Title>
        } style={{ width: '100%', maxWidth: 900, margin: '20px auto' }}>
          
          <p style={{ marginBottom: 20 }}>
            Review completed projects, analyze historical data, and delete old archives.
          </p>

          {projects.length === 0 ? (
            <Alert message="No Archived Projects" description="Start a new grow on the Dashboard to create archives when the project is finished." type="info" showIcon />
          ) : (
            <List
              itemLayout="horizontal"
              dataSource={projects}
              renderItem={item => (
                <List.Item
                  actions={[
                    <Button 
                      key="view" 
                      type="default" 
                      icon={<EyeOutlined />} 
                      onClick={() => router.push(`/archives/${item._id}`)}
                    >
                      View
                    </Button>,
                    <Button 
                      key="delete" 
                      danger 
                      icon={<DeleteOutlined />}
                      onClick={() => handleDelete(item._id, item.plantName)}
                    >
                      Delete
                    </Button>
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Text strong style={{ fontSize: '1.2em' }}>
                        {item.plantName.charAt(0).toUpperCase() + item.plantName.slice(1)}
                      </Text>
                    }
                    description={
                      <>
                        <Text type="secondary">
                          **Final Stage:** {item.finalStage.charAt(0).toUpperCase() + item.finalStage.slice(1)}
                        </Text>
                        <br />
                        <Text type="secondary">
                          **Duration:** {new Date(item.startDate).toLocaleDateString()} to {new Date(item.endDate).toLocaleDateString()}
                        </Text>
                      </>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </main>
    </div>
  );
}