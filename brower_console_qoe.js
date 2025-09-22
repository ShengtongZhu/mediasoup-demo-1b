// Enhanced QoE logging with automatic CSV file generation
// Run this in browser console to enable QoE logging with automatic CSV saves

// Enable QoE logging with 2-second intervals and CSV saves every 10 seconds
if (window.roomClient && window.roomClient.qoeManager) {
    // Enable with custom intervals
    window.roomClient.qoeManager.enable(2000, 10000); // 2s logging, 10s CSV saves
    
    console.log('✅ QoE logging enabled with automatic CSV saves every 10 seconds');
    console.log('📊 CSV files will be automatically downloaded and stored in localStorage');
    
    // Add some helper functions to window for easy access
    window.qoeHelpers = {
        // Change CSV save interval
        setCSVInterval: (intervalMs) => {
            if (window.roomClient.qoeManager.isEnabled) {
                window.roomClient.qoeManager.disable();
                window.roomClient.qoeManager.enable(2000, intervalMs);
                console.log(`📁 CSV save interval changed to ${intervalMs}ms`);
            }
        },
        
        // Manually save CSV now
        saveNow: () => {
            if (window.roomClient.qoeManager.isEnabled) {
                window.roomClient.qoeManager.collectCSVData();
                window.roomClient.qoeManager.saveCSVFile();
                console.log('💾 CSV file saved manually');
            }
        },
        
        // List stored CSV files
        listFiles: () => {
            const files = window.roomClient.qoeManager.getStoredCSVFiles();
            console.log('📋 Stored CSV files:', files);
            return files;
        },
        
        // Clear all stored files
        clearFiles: () => {
            window.roomClient.qoeManager.clearStoredCSVFiles();
            console.log('🗑️ All stored CSV files cleared');
        },
        
        // Download all stored files as a zip (if you have a zip library)
        downloadAll: () => {
            const files = window.roomClient.qoeManager.getStoredCSVFiles();
            files.forEach(file => {
                const blob = new Blob([file.content], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = file.filename;
                link.click();
                URL.revokeObjectURL(url);
            });
            console.log(`📦 Downloaded ${files.length} CSV files`);
        }
    };
    
    console.log('🛠️ Helper functions available:');
    console.log('  qoeHelpers.setCSVInterval(ms) - Change CSV save interval');
    console.log('  qoeHelpers.saveNow() - Save CSV file immediately');
    console.log('  qoeHelpers.listFiles() - List stored CSV files');
    console.log('  qoeHelpers.clearFiles() - Clear all stored files');
    console.log('  qoeHelpers.downloadAll() - Download all stored files');
    
} else {
    console.error('❌ QoE Manager not available. Make sure you are in a room with video consumers.');
}

// Example usage:
// qoeHelpers.setCSVInterval(5000);  // Save CSV every 5 seconds
// qoeHelpers.saveNow();             // Save immediately
// qoeHelpers.listFiles();           // See what's stored