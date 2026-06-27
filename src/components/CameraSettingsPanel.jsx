import React, { useState, useRef } from 'react';
import useWebcam from '../hooks/useWebcam';

export default function CameraSettingsPanel({ formData, onChange, onSave }) {
  const videoRef = useRef(null);
  const [snapshotPreview, setSnapshotPreview] = useState(null);

  // ✅ apply webcam hook dynamically
  const { captureSnapshot, reinitCamera } = useWebcam(videoRef, {
    flipHorizontal: formData.cameraConfig?.flipHorizontal || false,
    resolution: formData.cameraConfig?.resolution || '1920x1080',
  });

  const handleCameraChange = (key, value) => {
    onChange(prev => ({
      ...prev,
      cameraConfig: {
        ...prev.cameraConfig,
        [key]: value,
      },
    }));

    // ⚡ immediately reinit camera when changing source or resolution
    if (key === 'source' || key === 'resolution' || key === 'flipHorizontal') {
      setTimeout(() => reinitCamera(), 200);
    }
  };

  return (
    <div className="flex gap-8 max-w-6xl mx-auto">
      {/* LEFT SETTINGS PANEL */}
      <div className="flex-1 bg-white rounded-lg shadow p-6 space-y-6">

        {/* Camera Source */}
        <div>
          <label className="block font-semibold text-gray-700 mb-2">
            Camera Source
          </label>
          <select
            value={formData.cameraConfig?.source || 'webcam'}
            onChange={(e) => handleCameraChange('source', e.target.value)}
            className="w-48 px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-400"
          >
            <option value="webcam">Webcam</option>
            <option value="dslr">DSLR</option>
          </select>
        </div>

        {/* Resolution */}
        <div>
          <label className="block font-semibold text-gray-700 mb-2">Resolution</label>
          <select
            value={formData.cameraConfig?.resolution || '1920x1080'}
            onChange={(e) => handleCameraChange('resolution', e.target.value)}
            className="w-48 px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-400"
          >
            <option value="1920x1080">1920 x 1080 (Full HD)</option>
            <option value="1280x720">1280 x 720 (HD)</option>
            <option value="640x480">640 x 480 (SD)</option>
          </select>
        </div>

        {/* Flip */}
        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            checked={formData.cameraConfig?.flipHorizontal || false}
            onChange={(e) => handleCameraChange('flipHorizontal', e.target.checked)}
            className="w-5 h-5 text-indigo-600 border-gray-300 rounded"
          />
          <span className="text-gray-700">Flip Horizontally</span>
        </div>

        {/* Aspect Ratio */}
        <div>
          <label className="block font-semibold text-gray-700 mb-1">Aspect Ratio</label>
          <select
            value={formData.aspectRatio || '4:3'}
            onChange={(e) => onChange(prev => ({ ...prev, aspectRatio: e.target.value }))}
            className="w-64 px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-400"
          >
            <option value="3:2">3:2</option>
            <option value="4:3">4:3</option>
            <option value="16:9">16:9</option>
            <option value="1:1">1:1</option>
          </select>
        </div>

        {/* Save Button */}
        <button
          onClick={() => onSave(formData)}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded font-semibold mt-6"
        >
          Save Camera Settings
        </button>
      </div>

      {/* RIGHT LIVE PREVIEW */}
      <div className="w-96 flex flex-col items-center bg-gray-50 rounded-lg shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          Live Preview
        </h2>

        <div className="relative w-72 h-72 bg-black rounded-lg overflow-hidden border-4 border-gray-300">
          {formData.cameraConfig?.source === 'dslr' ? (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              DSLR Preview Not Available (Connect DSLR)
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${formData.cameraConfig?.flipHorizontal ? 'scale-x-[-1]' : ''}`}
            />
          )}
        </div>

        {/* Controls */}
        <div className="flex space-x-4 mt-4">
          <button
            onClick={() => reinitCamera()}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Test Camera
          </button>

          <button
            onClick={() => setSnapshotPreview(captureSnapshot())}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Take Snapshot
          </button>
        </div>

        {snapshotPreview && (
          <div className="mt-4">
            <h4 className="text-gray-700 font-medium mb-2">Snapshot Preview:</h4>
            <img
              src={snapshotPreview}
              alt="Snapshot"
              className="border rounded max-w-full shadow-md"
            />
          </div>
        )}
      </div>
    </div>
  );
}
