import React from 'react';
import SyllabusUploader from './components/SyllabusUploader.tsx';

function App() {
  return (
    <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
      <h1>SyllaSync</h1>
      <SyllabusUploader />
    </div>
  );
}

export default App;