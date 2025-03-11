import React, { useState, useEffect } from 'react';

interface ProgressBarProps {
    progress: number;
    label?: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progress, label }) => (
    <div style={{ marginBottom: '10px' }}>
        {label && <div style={{ marginBottom: '5px' }}>{label}</div>}
        <div style={{ 
            width: '100%', 
            backgroundColor: '#e0e0e0', 
            borderRadius: '4px',
            overflow: 'hidden'
        }}>
            <div style={{
                width: `${progress}%`,
                backgroundColor: '#1976d2',
                height: '10px',
                transition: 'width 0.3s ease-in-out'
            }} />
        </div>
        <div style={{ textAlign: 'right', fontSize: '12px' }}>
            {progress.toFixed(0)}%
        </div>
    </div>
);

interface ProcessingStage {
    filename: string;
    stage: 'pdf_extraction' | 'ai_processing' | 'calendar_update' | 'complete' | 'error';
    status: string;
}

const StageIndicator: React.FC<{ stage: ProcessingStage }> = ({ stage }) => {
    const getStageEmoji = () => {
        switch (stage.stage) {
            case 'pdf_extraction': return '📄';
            case 'ai_processing': return '🤖';
            case 'calendar_update': return '📅';
            case 'complete': return '✅';
            case 'error': return '❌';
            default: return '⏳';
        }
    };

    const getStageColor = () => {
        switch (stage.stage) {
            case 'complete': return '#4caf50';  // Green
            case 'error': return '#f44336';     // Red
            case 'pdf_extraction': return '#2196f3';  // Blue
            case 'ai_processing': return '#ff9800';   // Orange
            case 'calendar_update': return '#9c27b0';  // Purple
            default: return '#757575';  // Grey
        }
    };

    return (
        <div style={{ 
            padding: '12px',
            margin: '8px 0',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            borderLeft: `4px solid ${getStageColor()}`,
            transition: 'all 0.3s ease'
        }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                {getStageEmoji()} {stage.filename}
            </div>
            <div style={{ 
                fontSize: '14px', 
                color: '#666',
                paddingLeft: '24px'  // Indent status message
            }}>
                {stage.status}
            </div>
        </div>
    );
};

const SyllabusUploader: React.FC = () => {
    const [files, setFiles] = useState<FileList | null>(null);
    const [message, setMessage] = useState<string>('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [calendarType, setCalendarType] = useState<'google' | 'apple'>('google');
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        fetch('http://localhost:5002/auth/status', {
            credentials: 'include'
        })
        .then(res => res.json())
        .then(data => setIsAuthenticated(data.authenticated))
        .catch(() => setIsAuthenticated(false));
    }, []);

    const handleUpload = async () => {
        if (calendarType === 'google' && !isAuthenticated) {
            setMessage('Please login with Google first');
            return;
        }

        if (!files || files.length === 0) {
            setMessage('Please select at least one file');
            return;
        }

        setIsProcessing(true);
        setMessage('');

        const formData = new FormData();
        Array.from(files).forEach(file => {
            formData.append('file', file);
        });
        formData.append('calendar', calendarType);

        try {
            const response = await fetch('http://localhost:5002/upload', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            if (calendarType === 'apple') {
                if (!response.ok) {
                    const errorText = await response.text();
                    try {
                        const errorJson = JSON.parse(errorText);
                        throw new Error(errorJson.error || 'Upload failed');
                    } catch {
                        throw new Error('Failed to generate calendar file');
                    }
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'calendar-events.ics';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                setMessage('Calendar file downloaded successfully!');
            } else {
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Upload failed');
                }
                setMessage(data.message || 'Success!');
            }
        } catch (error) {
            console.error('Upload error:', error);
            setMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '20px' }}>
                <label>
                    <input
                        type="radio"
                        value="google"
                        checked={calendarType === 'google'}
                        onChange={(e) => setCalendarType(e.target.value as 'google' | 'apple')}
                        disabled={isProcessing}
                    /> Google Calendar
                </label>
                <label style={{ marginLeft: '10px' }}>
                    <input
                        type="radio"
                        value="apple"
                        checked={calendarType === 'apple'}
                        onChange={(e) => setCalendarType(e.target.value as 'google' | 'apple')}
                        disabled={isProcessing}
                    /> Apple Calendar
                </label>
            </div>

            {calendarType === 'google' && !isAuthenticated ? (
                <button 
                    onClick={() => window.location.href = 'http://localhost:5002/auth/google'}
                    disabled={isProcessing}
                >
                    Sign in with Google
                </button>
            ) : (
                <>
                    <input 
                        type="file" 
                        multiple
                        accept=".pdf"
                        onChange={(e) => setFiles(e.target.files)}
                        disabled={isProcessing}
                    />
                    <button 
                        onClick={handleUpload}
                        disabled={isProcessing}
                        style={{ marginLeft: '10px' }}
                    >
                        {isProcessing ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div className="spinner" style={{
                                    width: '20px',
                                    height: '20px',
                                    border: '3px solid #f3f3f3',
                                    borderTop: '3px solid #3498db',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite'
                                }} />
                                Processing...
                            </div>
                        ) : (
                            'Upload Syllabi'
                        )}
                    </button>
                </>
            )}

            {/* Message */}
            {message && (
                <p style={{ 
                    marginTop: '20px',
                    fontWeight: 'bold',
                    color: message.includes('error') ? 'red' : 'green'
                }}>
                    {message}
                </p>
            )}

            {/* Add CSS for spinner animation */}
            <style>
                {`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}
            </style>
        </div>
    );
};

export default SyllabusUploader;