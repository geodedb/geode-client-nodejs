/**
 * Native Node.js client benchmark for Geode
 *
 * Usage: npx tsx benchmarks/benchmark.ts --host localhost --port 3141 --workers 10 --queries 1000
 */

import { createClientWithConfig, type GeodeConfig } from '../src/index.js';

interface BenchmarkResult {
  timestamp: string;
  duration_seconds: number;
  total_queries: number;
  successful_queries: number;
  failed_queries: number;
  throughput_qps: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  latency_avg_ms: number;
  workers: number;
  queries_per_worker: number;
  status: string;
}

function parseArgs(): {
  host: string;
  port: number;
  workers: number;
  queries: number;
  json: boolean;
} {
  const args = process.argv.slice(2);
  let host = 'localhost';
  let port = 3141;
  let workers = 10;
  let queries = 1000;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--host':
        host = args[++i] || host;
        break;
      case '--port':
        port = parseInt(args[++i], 10) || port;
        break;
      case '--workers':
        workers = parseInt(args[++i], 10) || workers;
        break;
      case '--queries':
        queries = parseInt(args[++i], 10) || queries;
        break;
      case '--json':
        json = true;
        break;
    }
  }

  return { host, port, workers, queries, json };
}

async function runWorker(
  config: GeodeConfig,
  queries: number,
): Promise<{ latencies: number[]; successful: number; failed: number }> {
  const latencies: number[] = [];
  let successful = 0;
  let failed = 0;

  try {
    const client = await createClientWithConfig(config, { pooling: false });

    for (let i = 0; i < queries; i++) {
      const start = performance.now();
      try {
        const result = await client.query('RETURN 1');
        // Consume result
        for await (const _row of result) {
          // Just iterate
        }
        const latency = performance.now() - start;
        latencies.push(latency);
        successful++;
      } catch (e) {
        if (failed < 3) {
          console.error(`Query ${i} failed:`, e);
        }
        failed++;
      }
    }

    await client.close();
  } catch (e) {
    console.error('Connection failed:', e);
    failed += queries;
  }

  return { latencies, successful, failed };
}

async function main(): Promise<void> {
  const { host, port, workers, queries, json } = parseArgs();

  const config: GeodeConfig = {
    host,
    port,
    pageSize: 1000,
    helloName: 'geode-nodejs-benchmark',
    helloVersion: '1.0.0',
    conformance: 'min',
    insecureSkipVerify: true,
  };

  const start = performance.now();

  // Run all workers concurrently
  const workerPromises = Array(workers)
    .fill(null)
    .map(() => runWorker(config, queries));

  const results = await Promise.all(workerPromises);

  const duration = (performance.now() - start) / 1000;

  // Aggregate results
  const allLatencies: number[] = [];
  let totalSuccessful = 0;
  let totalFailed = 0;

  for (const result of results) {
    allLatencies.push(...result.latencies);
    totalSuccessful += result.successful;
    totalFailed += result.failed;
  }

  // Calculate statistics
  allLatencies.sort((a, b) => a - b);

  let p50 = 0,
    p95 = 0,
    p99 = 0,
    avg = 0;
  if (allLatencies.length > 0) {
    p50 = allLatencies[Math.floor(allLatencies.length / 2)];
    p95 = allLatencies[Math.floor(allLatencies.length * 0.95)];
    p99 = allLatencies[Math.floor(allLatencies.length * 0.99)];
    avg = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
  }

  const throughput = totalSuccessful / duration;

  let status = 'LIMITED';
  if (throughput >= 10000) status = 'EXCELLENT';
  else if (throughput >= 1000) status = 'GOOD';
  else if (throughput >= 100) status = 'ACCEPTABLE';

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    duration_seconds: duration,
    total_queries: totalSuccessful + totalFailed,
    successful_queries: totalSuccessful,
    failed_queries: totalFailed,
    throughput_qps: throughput,
    latency_p50_ms: p50,
    latency_p95_ms: p95,
    latency_p99_ms: p99,
    latency_avg_ms: avg,
    workers,
    queries_per_worker: queries,
    status,
  };

  if (json) {
    console.log(JSON.stringify(result));
  } else {
    console.log('======================================================================');
    console.log('NODEJS CLIENT BENCHMARK RESULTS');
    console.log('======================================================================');
    console.log(`Duration: ${result.duration_seconds.toFixed(2)}s`);
    console.log(`Workers: ${result.workers}`);
    console.log(`Queries/worker: ${result.queries_per_worker}`);
    console.log();
    console.log('RESULTS:');
    console.log(`  Total queries:    ${result.total_queries}`);
    console.log(`  Successful:       ${result.successful_queries}`);
    console.log(`  Failed:           ${result.failed_queries}`);
    console.log(`  Throughput:       ${result.throughput_qps.toFixed(0)} qps`);
    console.log();
    console.log('LATENCY:');
    console.log(`  p50:  ${result.latency_p50_ms.toFixed(2)}ms`);
    console.log(`  p95:  ${result.latency_p95_ms.toFixed(2)}ms`);
    console.log(`  p99:  ${result.latency_p99_ms.toFixed(2)}ms`);
    console.log(`  avg:  ${result.latency_avg_ms.toFixed(2)}ms`);
    console.log();
    console.log(`STATUS: ${result.status}`);
    console.log('======================================================================');
  }
}

main().catch(console.error);
