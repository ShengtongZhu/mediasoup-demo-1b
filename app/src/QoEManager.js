import Logger from './Logger';
import QoELogger from './QoELogger';

const logger = new Logger('QoEManager');

/**
 * QoE Manager - Manages QoE logging for all video consumers
 */
export default class QoEManager {
	constructor(roomClient) {
		this.roomClient = roomClient;
		this.qoeLoggers = new Map(); // consumerId -> QoELogger
		this.isEnabled = false;
		this.logInterval = 2000; // Default 2 seconds
		this.csvSaveInterval = null;
		this.csvSaveIntervalMs = 10000; // Default 10 seconds for CSV saves
		this.csvData = []; // Store CSV rows for batch writing
		this.sessionStartTime = null;

		// Bind methods
		this.enable = this.enable.bind(this);
		this.disable = this.disable.bind(this);
		this.addConsumer = this.addConsumer.bind(this);
		this.removeConsumer = this.removeConsumer.bind(this);
		this.saveCSVFile = this.saveCSVFile.bind(this);
		this.collectCSVData = this.collectCSVData.bind(this);
	}

	/**
	 * Enable QoE logging for all current and future consumers
	 * @param {number} intervalMs - Logging interval in milliseconds
	 * @param {number} csvSaveIntervalMs - CSV file save interval in milliseconds
	 */
	enable(intervalMs = 2000, csvSaveIntervalMs = 10000) {
		if (this.isEnabled) {
			logger.warn('QoE Manager already enabled');
			return;
		}

		this.isEnabled = true;
		this.logInterval = intervalMs;
		this.csvSaveIntervalMs = csvSaveIntervalMs;
		this.sessionStartTime = new Date();
		this.csvData = [];
		
		logger.debug('QoE Manager enabled with %d ms interval, CSV save every %d ms', intervalMs, csvSaveIntervalMs);

		// Start logging for existing consumers
		for (const qoeLogger of this.qoeLoggers.values()) {
			qoeLogger.start(intervalMs);
		}

		// Log CSV header for easy parsing
		const headers = [
			'timestamp', 'peerId', 'consumerId', 'frameRate(fps)', 
			'bitrate(kbps)', 'packetLoss(%)', 'jitter(ms)', 'frameDelay(ms)', 
			'resolution', 'codec', 'score', 'fractionLost(%)'
		];
		console.log('QoE_CSV_HEADER: ' + headers.join(','));

		// Set up periodic CSV file saving
		this.csvSaveInterval = setInterval(() => {
			this.collectCSVData();
			this.saveCSVFile();
		}, csvSaveIntervalMs);

		// Save initial CSV file with headers
		this.saveCSVFile(true);
	}

	/**
	 * Disable QoE logging for all consumers
	 */
	disable() {
		if (!this.isEnabled) {
			return;
		}

		this.isEnabled = false;
		logger.debug('QoE Manager disabled');

		// Stop all loggers
		for (const qoeLogger of this.qoeLoggers.values()) {
			qoeLogger.stop();
		}

		// Stop CSV saving
		if (this.csvSaveInterval) {
			clearInterval(this.csvSaveInterval);
			this.csvSaveInterval = null;
		}

		// Save final CSV file
		this.collectCSVData();
		this.saveCSVFile();
	}

	/**
	 * Add a consumer for QoE logging
	 * @param {string} consumerId - Consumer ID
	 * @param {string} peerId - Peer ID
	 * @param {string} kind - Media kind ('video' or 'audio')
	 */
	addConsumer(consumerId, peerId, kind = 'video') {
		// Only log video consumers for QoE
		if (kind !== 'video') {
			return;
		}

		if (this.qoeLoggers.has(consumerId)) {
			logger.warn('Consumer %s already being logged', consumerId);
			return;
		}

		logger.debug('Adding consumer %s (peer: %s) for QoE logging', consumerId, peerId);

		const qoeLogger = new QoELogger(consumerId, peerId, this.roomClient);
		this.qoeLoggers.set(consumerId, qoeLogger);

		// Start logging if manager is enabled
		if (this.isEnabled) {
			qoeLogger.start(this.logInterval);
		}
	}

	/**
	 * Remove a consumer from QoE logging
	 * @param {string} consumerId - Consumer ID
	 */
	removeConsumer(consumerId) {
		const qoeLogger = this.qoeLoggers.get(consumerId);
		if (!qoeLogger) {
			return;
		}

		logger.debug('Removing consumer %s from QoE logging', consumerId);

		qoeLogger.stop();
		this.qoeLoggers.delete(consumerId);
	}

	/**
	 * Collect current CSV data from all loggers
	 */
	collectCSVData() {
		const currentTime = Date.now();
		
		for (const [consumerId, qoeLogger] of this.qoeLoggers) {
			const metrics = qoeLogger.getCurrentMetrics();
			
			// Only collect if we have valid metrics
			if (metrics.timestamp && metrics.timestamp > 0) {
				const row = [
					metrics.timestamp,
					qoeLogger.peerId,
					consumerId,
					metrics.frameRate,
					Math.round(metrics.bitrate / 1000),
					metrics.packetLoss,
					metrics.jitter,
					metrics.frameDelay,
					`${metrics.resolution.width}x${metrics.resolution.height}`,
					metrics.codec,
					metrics.score || 'N/A',
					metrics.fractionLost || 'N/A'
				];
				
				this.csvData.push(row);
			}
		}
	}

	/**
	 * Save CSV file to local storage or download
	 * @param {boolean} headersOnly - If true, only save headers
	 */
	saveCSVFile(headersOnly = false) {
		try {
			const headers = [
				'timestamp', 'peerId', 'consumerId', 'frameRate(fps)', 
				'bitrate(kbps)', 'packetLoss(%)', 'jitter(ms)', 'frameDelay(ms)', 
				'resolution', 'codec', 'score', 'fractionLost(%)'
			];

			let csvContent = headers.join(',') + '\n';

			if (!headersOnly && this.csvData.length > 0) {
				// Add all collected data
				for (const row of this.csvData) {
					csvContent += row.join(',') + '\n';
				}
				
				// Clear the data after saving
				this.csvData = [];
			}

			// Generate filename with timestamp
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const filename = `qoe-metrics-${timestamp}.csv`;

			// Create and download the file
			this.downloadCSVFile(csvContent, filename);

			// Also store in localStorage for persistence
			this.storeCSVInLocalStorage(csvContent, filename);

			logger.debug('CSV file saved: %s (%d bytes)', filename, csvContent.length);

		} catch (error) {
			logger.error('Error saving CSV file: %o', error);
		}
	}

	/**
	 * Download CSV file to user's machine
	 * @param {string} csvContent - CSV content
	 * @param {string} filename - Filename
	 */
	downloadCSVFile(csvContent, filename) {
		try {
			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			const link = document.createElement('a');
			
			if (link.download !== undefined) {
				const url = URL.createObjectURL(blob);
				link.setAttribute('href', url);
				link.setAttribute('download', filename);
				link.style.visibility = 'hidden';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(url);
			}
		} catch (error) {
			logger.error('Error downloading CSV file: %o', error);
		}
	}

	/**
	 * Store CSV data in localStorage
	 * @param {string} csvContent - CSV content
	 * @param {string} filename - Filename
	 */
	storeCSVInLocalStorage(csvContent, filename) {
		try {
			// Store current file
			localStorage.setItem(`qoe-csv-${filename}`, csvContent);
			
			// Maintain a list of all CSV files
			const existingFiles = JSON.parse(localStorage.getItem('qoe-csv-files') || '[]');
			if (!existingFiles.includes(filename)) {
				existingFiles.push(filename);
				
				// Keep only last 10 files to avoid storage overflow
				if (existingFiles.length > 10) {
					const oldFile = existingFiles.shift();
					localStorage.removeItem(`qoe-csv-${oldFile}`);
				}
				
				localStorage.setItem('qoe-csv-files', JSON.stringify(existingFiles));
			}
		} catch (error) {
			logger.error('Error storing CSV in localStorage: %o', error);
		}
	}

	/**
	 * Get all stored CSV files from localStorage
	 * @returns {Array} Array of {filename, content} objects
	 */
	getStoredCSVFiles() {
		try {
			const files = JSON.parse(localStorage.getItem('qoe-csv-files') || '[]');
			return files.map(filename => ({
				filename,
				content: localStorage.getItem(`qoe-csv-${filename}`) || '',
				size: (localStorage.getItem(`qoe-csv-${filename}`) || '').length
			}));
		} catch (error) {
			logger.error('Error retrieving stored CSV files: %o', error);
			return [];
		}
	}

	/**
	 * Clear all stored CSV files
	 */
	clearStoredCSVFiles() {
		try {
			const files = JSON.parse(localStorage.getItem('qoe-csv-files') || '[]');
			files.forEach(filename => {
				localStorage.removeItem(`qoe-csv-${filename}`);
			});
			localStorage.removeItem('qoe-csv-files');
			logger.debug('Cleared all stored CSV files');
		} catch (error) {
			logger.error('Error clearing stored CSV files: %o', error);
		}
	}

	/**
	 * Get QoE metrics for all consumers
	 * @returns {Object} QoE metrics for all consumers
	 */
	getAllMetrics() {
		const metrics = {};
		for (const [consumerId, qoeLogger] of this.qoeLoggers) {
			metrics[consumerId] = qoeLogger.getCurrentMetrics();
		}
		return metrics;
	}

	/**
	 * Get QoE metrics for a specific consumer
	 * @param {string} consumerId - Consumer ID
	 * @returns {Object|null} QoE metrics or null if not found
	 */
	getConsumerMetrics(consumerId) {
		const qoeLogger = this.qoeLoggers.get(consumerId);
		return qoeLogger ? qoeLogger.getCurrentMetrics() : null;
	}

	/**
	 * Get session summary for all consumers
	 * @returns {Array} Array of session summaries
	 */
	getSessionSummary() {
		const summaries = [];
		for (const qoeLogger of this.qoeLoggers.values()) {
			summaries.push(qoeLogger.getSessionSummary());
		}
		return summaries;
	}

	/**
	 * Export QoE data as CSV (current snapshot)
	 * @returns {string} CSV formatted QoE data
	 */
	exportAsCSV() {
		const headers = [
			'timestamp', 'peerId', 'consumerId', 'frameRate(fps)', 
			'bitrate(kbps)', 'packetLoss(%)', 'jitter(ms)', 'frameDelay(ms)', 
			'resolution', 'codec', 'score', 'fractionLost(%)'
		];

		let csv = headers.join(',') + '\n';

		for (const [consumerId, qoeLogger] of this.qoeLoggers) {
			const metrics = qoeLogger.getCurrentMetrics();
			const row = [
				metrics.timestamp,
				qoeLogger.peerId,
				consumerId,
				metrics.frameRate,
				Math.round(metrics.bitrate / 1000),
				metrics.packetLoss,
				metrics.jitter,
				metrics.frameDelay,
				`${metrics.resolution.width}x${metrics.resolution.height}`,
				metrics.codec,
				metrics.score || 'N/A',
				metrics.fractionLost || 'N/A'
			];
			csv += row.join(',') + '\n';
		}

		return csv;
	}
}