'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, Spin, Typography, Alert, Divider } from 'antd';
import Navbar from '../components/navbar'; 
import HistoricalCharts from '../components/HistoricalCharts'; 
import styles from '../styles/dashboard.module.css';

const { Title, Text, Paragraph } = Typography;

export default function ArchivedProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId;
  const [projectData, setProjectData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!projectId) return;

    // Fetch the specific archive metadata
    const fetchArchive = async () => {
      try {
        // Use the existing archives API route to get metadata
        const response = await fetch(`/api/archives?projectId=${projectId}`); 
        if (!response.ok) throw new Error('Failed to fetch project details');
        const data = await response.json();
        
        // This is a dummy call since the previous API was not designed to return a single project.
        // We need to modify /api/archives/route.js to handle this, but for now, simulate data.
        // In reality, you'd add a GET handler to /api/archives that checks for the projectId param.
        setProjectData(data.projects[0] || { /* Simulation of detailed data */ }); 

        // For this example, let's assume we call a specific new endpoint for detail:
        const detailResponse = await fetch(`/api/archives?projectId=${projectId}&detail=true`);
        if (!detailResponse.ok) throw new Error('Failed to fetch project details');
        setProjectData(await detailResponse.json());

      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchArchive();
  }, [projectId]);

  if (loading) {
    return <Spin size="large" className={styles.loadingContainer} />;
  }

  if (error || !projectData) {
    return (
      <Alert 
        message="Error" 
        description={error || "Archived project not found."} 
        type="error" 
        showIcon 
        style={{ margin: 20 }}
      />
    );
  }

  // Helper to format the duration
  const durationInDays = Math.ceil((new Date(projectData.endDate).getTime() - new Date(projectData.startDate).getTime()) / (1000 * 60 * 60 * 24));
  
  // Create the specific data object structure expected by HistoricalCharts
  const chartProps = {
    // The HistoricalCharts component must be modified slightly to accept 
    // projectData.sensorDataQueryKey and projectData.idealConditions directly
    // instead of relying on fetching appState.
    // For now, we pass the crucial IDs/dates:
    isArchive: true,
    startDate: projectData.startDate,
    endDate: projectData.endDate,
    idealConditions: projectData.idealConditions,
    show: true, // Always show the chart on this dedicated page
  };

  return (
    <div className={styles.container}>
      <Navbar />
      <main className={styles.main} style={{ paddingTop: '20px' }}>
        <Card style={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
          <Title level={2}>{projectData.plantName.toUpperCase()} Project Report</Title>
          <Paragraph>
            <Text strong>Status:</Text> <Text type="success">Completed</Text>
          </Paragraph>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '20px' }}>
            <div>
              <Text strong>Started:</Text><br />
              {new Date(projectData.startDate).toLocaleDateString()}
            </div>
            <div>
              <Text strong>Finished:</Text><br />
              {new Date(projectData.endDate).toLocaleDateString()}
            </div>
            <div>
              <Text strong>Duration:</Text><br />
              {durationInDays} Days
            </div>
          </div>
          <Divider />
          
          <Title level={3}>Final Snapshot & Ideal Conditions</Title>
          {/* Display Final Sensor Data and Ideal Conditions here */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
            <div>
              <Text strong>Final Sensor Data:</Text>
              <ul>
                {projectData.finalSensorData ? Object.entries(projectData.finalSensorData).map(([key, value]) => (
                  <li key={key}><Text strong>{key}:</Text> {value}</li>
                )) : <li>No final data recorded.</li>}
              </ul>
            </div>
            <div>
              <Text strong>Ideal Conditions Used:</Text>
              <ul>
                {Object.entries(projectData.idealConditions).map(([key, value]) => (
                  <li key={key}><Text strong>{key}:</Text> {value.min || value.temp_min || value.ph_min} - {value.max || value.temp_max || value.ph_max}</li>
                ))}
              </ul>
            </div>
          </div>
          
          <Divider />
          
          {/* Historical Charts (MUST BE MODIFIED to fetch archive data) */}
          <Title level={3}>Historical Data Trend</Title>
          {/* NOTE: HistoricalCharts needs an update to fetch data using startDate/endDate */}
          <HistoricalCharts {...chartProps} /> 
          
        </Card>
      </main>
    </div>
  );
}