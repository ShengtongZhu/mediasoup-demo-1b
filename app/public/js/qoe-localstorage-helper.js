/**
 * QoE LocalStorage Helper Script
 * Run this in the browser console to manage QoE CSV data stored in localStorage
 * No file downloads - everything stays in browser storage
 */

// Helper functions for QoE localStorage management
window.QoELocalStorageHelper = {
    
    /**
     * Enable QoE logging with localStorage-only storage
     * @param {number} logInterval - Logging interval in ms (default: 2000)
     * @param {number} saveInterval - Save interval in ms (default: 10000)
     */
    enable: function(logInterval = 2000, saveInterval = 10000) {
        if (window.roomClient && window.roomClient.qoeManager) {
            window.roomClient.qoeManager.enable(logInterval, saveInterval);
            console.log(`✅ QoE logging enabled (log: ${logInterval}ms, save: ${saveInterval}ms)`);
            console.log('📊 Data will be automatically saved to localStorage');
        } else {
            console.error('❌ QoE Manager not found. Make sure you are in a mediasoup room.');
        }
    },

    /**
     * Disable QoE logging
     */
    disable: function() {
        if (window.roomClient && window.roomClient.qoeManager) {
            window.roomClient.qoeManager.disable();
            console.log('⏹️ QoE logging disabled');
        } else {
            console.error('❌ QoE Manager not found');
        }
    },

    /**
     * Set CSV save interval
     * @param {number} intervalMs - New interval in milliseconds
     */
    setSaveInterval: function(intervalMs) {
        if (window.roomClient && window.roomClient.qoeManager) {
            window.roomClient.qoeManager.setCSVSaveInterval(intervalMs);
            console.log(`⏱️ CSV save interval set to ${intervalMs}ms`);
        } else {
            console.error('❌ QoE Manager not found');
        }
    },

    /**
     * Manually save CSV data
     */
    saveNow: function() {
        if (window.roomClient && window.roomClient.qoeManager) {
            window.roomClient.qoeManager.manualSaveCSV();
            console.log('💾 Manual CSV save triggered');
        } else {
            console.error('❌ QoE Manager not found');
        }
    },

    /**
     * List all stored CSV files
     */
    listFiles: function() {
        if (window.roomClient && window.roomClient.qoeManager) {
            const files = window.roomClient.qoeManager.getStoredCSVFiles();
            console.log('📁 Stored CSV Files:');
            console.table(files.map(f => ({
                filename: f.filename,
                size: `${Math.round(f.size / 1024)} KB`,
                timestamp: f.timestamp,
                rows: f.content.split('\n').length - 1
            })));
            return files;
        } else {
            console.error('❌ QoE Manager not found');
            return [];
        }
    },

    /**
     * Get storage statistics
     */
    getStats: function() {
        if (window.roomClient && window.roomClient.qoeManager) {
            const stats = window.roomClient.qoeManager.getStorageStats();
            console.log('📊 Storage Statistics:');
            console.log(`Total Files: ${stats.totalFiles}`);
            console.log(`Total Size: ${stats.totalSizeKB} KB`);
            console.table(stats.files);
            return stats;
        } else {
            console.error('❌ QoE Manager not found');
            return null;
        }
    },

    /**
     * View a specific CSV file content
     * @param {string} filename - Filename to view
     */
    viewFile: function(filename) {
        if (window.roomClient && window.roomClient.qoeManager) {
            const content = window.roomClient.qoeManager.getCSVFile(filename);
            if (content) {
                console.log(`📄 Content of ${filename}:`);
                console.log(content);
                return content;
            } else {
                console.error(`❌ File ${filename} not found`);
                return null;
            }
        } else {
            console.error('❌ QoE Manager not found');
            return null;
        }
    },

    /**
     * Copy CSV file content to clipboard
     * @param {string} filename - Filename to copy
     */
    copyToClipboard: function(filename) {
        if (window.roomClient && window.roomClient.qoeManager) {
            const content = window.roomClient.qoeManager.getCSVFile(filename);
            if (content) {
                navigator.clipboard.writeText(content).then(() => {
                    console.log(`📋 ${filename} copied to clipboard`);
                }).catch(err => {
                    console.error('❌ Failed to copy to clipboard:', err);
                });
            } else {
                console.error(`❌ File ${filename} not found`);
            }
        } else {
            console.error('❌ QoE Manager not found');
        }
    },

    /**
     * Copy all CSV data as one combined file
     */
    copyAllData: function() {
        if (window.roomClient && window.roomClient.qoeManager) {
            const files = window.roomClient.qoeManager.getStoredCSVFiles();
            if (files.length === 0) {
                console.log('📭 No CSV files found');
                return;
            }

            // Combine all files
            let combinedContent = '';
            let headerAdded = false;

            files.forEach(file => {
                const lines = file.content.split('\n');
                if (!headerAdded && lines.length > 0) {
                    combinedContent += lines[0] + '\n'; // Add header
                    headerAdded = true;
                }
                // Add data rows (skip header)
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim()) {
                        combinedContent += lines[i] + '\n';
                    }
                }
            });

            navigator.clipboard.writeText(combinedContent).then(() => {
                console.log(`📋 All CSV data copied to clipboard (${files.length} files combined)`);
            }).catch(err => {
                console.error('❌ Failed to copy to clipboard:', err);
            });
        } else {
            console.error('❌ QoE Manager not found');
        }
    },

    /**
     * Clear all stored CSV files
     */
    clearAll: function() {
        if (confirm('Are you sure you want to delete all stored CSV files?')) {
            if (window.roomClient && window.roomClient.qoeManager) {
                window.roomClient.qoeManager.clearStoredCSVFiles();
                console.log('🗑️ All CSV files cleared');
            } else {
                console.error('❌ QoE Manager not found');
            }
        }
    },

    /**
     * Show current QoE metrics in console
     */
    showCurrentMetrics: function() {
        if (window.roomClient && window.roomClient.qoeManager) {
            const metrics = window.roomClient.qoeManager.getAllMetrics();
            console.log('📊 Current QoE Metrics:');
            console.table(metrics);
            return metrics;
        } else {
            console.error('❌ QoE Manager not found');
            return null;
        }
    },

    /**
     * Display help information
     */
    help: function() {
        console.log(`
🎯 QoE LocalStorage Helper Commands:

📊 Data Collection:
  QoELocalStorageHelper.enable(logInterval, saveInterval) - Enable QoE logging
  QoELocalStorageHelper.disable() - Disable QoE logging
  QoELocalStorageHelper.setSaveInterval(ms) - Change save interval
  QoELocalStorageHelper.saveNow() - Manual save

📁 File Management:
  QoELocalStorageHelper.listFiles() - List all stored files
  QoELocalStorageHelper.getStats() - Show storage statistics
  QoELocalStorageHelper.viewFile(filename) - View file content
  QoELocalStorageHelper.clearAll() - Delete all files

📋 Data Export:
  QoELocalStorageHelper.copyToClipboard(filename) - Copy file to clipboard
  QoELocalStorageHelper.copyAllData() - Copy all data combined

📊 Real-time:
  QoELocalStorageHelper.showCurrentMetrics() - Show current metrics

Example usage:
  QoELocalStorageHelper.enable(2000, 10000); // Log every 2s, save every 10s
  QoELocalStorageHelper.listFiles(); // See all files
  QoELocalStorageHelper.copyAllData(); // Copy everything to clipboard
        `);
    }
};

// Auto-show help on load
console.log('🎯 QoE LocalStorage Helper loaded! Type QoELocalStorageHelper.help() for commands');

// Quick aliases for convenience
window.qoe = window.QoELocalStorageHelper;
console.log('💡 Quick alias available: use "qoe.enable()" instead of "QoELocalStorageHelper.enable()"');