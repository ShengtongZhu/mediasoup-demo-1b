// Enable QoE logging with 2-second intervals
roomClient.enableQoELogging(2000);

// Get current QoE metrics for all consumers
const metrics = roomClient.getQoEMetrics();
console.log(metrics);

// Get QoE metrics for a specific consumer
const consumerMetrics = roomClient.getConsumerQoEMetrics('consumer-id');

// Export QoE data as CSV
const csvData = roomClient.exportQoEAsCSV();
console.log(csvData);

// Disable QoE logging
roomClient.disableQoELogging();