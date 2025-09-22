import autocannon from "autocannon";
import { writeFileSync } from "fs";
import axios from "axios";

class PrismaReplicaLoadTester {
  constructor() {
    this.baseUrl = "http://localhost:3000";

    this.testConfig = {
      endpoints: {
        // Individual service endpoints
        user: "/user/123",
        attendance: "/attendance/123/01",
        leaves: "/leaves/123/history",
        dashboard: "/user/123/dashboard/01",
      },
      headers: {
        "Content-Type": "application/json",
        Connection: "keep-alive",
      },
    };

    this.coolDownConfig = {
      betweenTests: 45000, // 45 seconds between tests (longer for 60s tests)
      afterFailure: 60000, // 1 minute after failure
      beforeCleanup: 5000,
      afterCleanup: 5000,
    };
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getStats() {
    try {
      const response = await axios.get(`${this.baseUrl}/stats`);
      return response.data;
    } catch (error) {
      console.warn(`[TEST] Could not get stats: ${error.message}`);
      return null;
    }
  }

  async runSingleTest(testConfig, resetBefore = false) {
    const { name, connections, duration, endpoint, expectedRPS } = testConfig;

    console.log(
      `\n🚀 [TEST] Starting ${name} test (${connections} connections, ${duration}s)`
    );
    console.log(`   📍 Endpoint: ${endpoint}`);
    console.log(`   🎯 Target: ${expectedRPS} RPS`);

    try {
      if (resetBefore) {
        console.log(`[TEST] Waiting for system stabilization...`);
        await this.sleep(this.coolDownConfig.beforeCleanup);
      }

      // Get baseline stats
      const beforeStats = await this.getStats();

      // Run the load test
      const startTime = Date.now();
      const result = await autocannon({
        url: `${this.baseUrl}${endpoint}`,
        connections: connections,
        duration: duration,
        headers: this.testConfig.headers,
        timeout: Math.max(30, duration * 1.5), // Longer timeout for 60s tests
        connectionTimeout: 15,
        renderProgressBar: true, // Enable progress bar for longer tests
        renderLatencyTable: false,
        renderResultsTable: true, // Show results table
      });

      const testDuration = Date.now() - startTime;

      // Get post-test stats
      const afterStats = await this.getStats();

      // Calculate metrics
      const metrics = {
        testName: name,
        endpoint,
        connections,
        duration: testDuration,
        rps: Math.round(result.requests?.average || 0),
        expectedRPS,
        latency: {
          average: result.latency?.average || 0,
          p50: result.latency?.p50 || 0,
          p90: result.latency?.p90 || 0,
          p95: result.latency?.p95 || 0,
          p99: result.latency?.p99 || 0,
        },
        throughput: {
          totalRequests: result.requests?.total || 0,
          totalBytes: result.throughput?.total || 0,
          avgBytesPerSecond: result.throughput?.average || 0,
        },
        reliability: {
          successRate:
            ((result["2xx"] || 0) / (result.requests?.total || 1)) * 100,
          errors: result.errors || 0,
          timeouts: result.timeouts || 0,
          totalRequests: result.requests?.total || 0,
          status2xx: result["2xx"] || 0,
          status3xx: result["3xx"] || 0,
          status4xx: result["4xx"] || 0,
          status5xx: result["5xx"] || 0,
        },
        prismaStats: {
          before: beforeStats,
          after: afterStats,
        },
      };

      // Determine success (more lenient criteria for high load)
      const isSuccess =
        metrics.reliability.successRate > 97 && // 90% success rate
        metrics.reliability.errors < 50 && // Allow more errors for high load
        metrics.rps > expectedRPS * 0.9; // At least 90% of expected RPS

      console.log(`\n   📊 TEST RESULTS FOR ${name}:`);
      console.log(
        `   ✨ RPS Achieved: ${metrics.rps} / ${expectedRPS} (${(
          (metrics.rps / expectedRPS) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `   📈 Success Rate: ${metrics.reliability.successRate.toFixed(1)}%`
      );
      console.log(
        `   ⏱️ Latency - Avg: ${metrics.latency.average.toFixed(
          1
        )}ms, P99: ${metrics.latency.p99.toFixed(1)}ms`
      );
      console.log(
        `   📦 Total Requests: ${metrics.throughput.totalRequests.toLocaleString()}`
      );
      console.log(
        `   ❌ Errors: ${metrics.reliability.errors}, Timeouts: ${metrics.reliability.timeouts}`
      );

      if (isSuccess) {
        console.log(`   ✅ ${name} test PASSED`);
      } else {
        console.log(`   ❌ ${name} test FAILED`);
      }

      return { ...metrics, success: isSuccess };
    } catch (error) {
      console.error(`   💥 ${name} test crashed: ${error.message}`);
      return {
        testName: name,
        endpoint,
        connections,
        error: error.message,
        success: false,
        crashed: true,
      };
    }
  }

  async runServiceLoadTests() {
    // Test configurations - each service individually with same parameters
    const testLevels = [
      {
        name: "User Service Load Test",
        endpoint: this.testConfig.endpoints.user,
        connections: 1500,
        duration: 60,
        expectedRPS: 5000,
      },
      {
        name: "Attendance Service Load Test",
        endpoint: this.testConfig.endpoints.attendance,
        connections: 1500,
        duration: 60,
        expectedRPS: 5000,
      },
      {
        name: "Leaves Service Load Test",
        endpoint: this.testConfig.endpoints.leaves,
        connections: 1500,
        duration: 60,
        expectedRPS: 5000,
      },
      {
        name: "Dashboard Service Load Test",
        endpoint: this.testConfig.endpoints.dashboard,
        connections: 1500,
        duration: 60,
        expectedRPS: 5000,
      },
    ];

    const results = [];
    let overallSuccess = true;

    for (let i = 0; i < testLevels.length; i++) {
      const level = testLevels[i];

      console.log(`\n${"=".repeat(60)}`);
      console.log(`🧪 TEST ${i + 1}/${testLevels.length}: ${level.name}`);
      console.log(`${"=".repeat(60)}`);

      const result = await this.runSingleTest(level, i === 0);
      results.push(result);

      if (result.success) {
        console.log(`✅ ${level.name} PASSED - ${result.rps} RPS achieved`);
      } else {
        console.log(
          `❌ ${level.name} FAILED - Only ${result.rps} RPS achieved`
        );
        overallSuccess = false;
      }

      // Cool down between tests (except after the last test)
      if (i < testLevels.length - 1) {
        const coolDownTime = result.success
          ? this.coolDownConfig.betweenTests / 1000
          : this.coolDownConfig.afterFailure / 1000;

        console.log(
          `\n😴 [COOLDOWN] Waiting ${coolDownTime} seconds before next test...`
        );
        console.log(
          `   🔄 Allowing system to stabilize and connections to reset`
        );

        // Show countdown
        for (let j = coolDownTime; j > 0; j -= 10) {
          if (j <= 10) {
            console.log(`   ⏳ ${j} seconds remaining...`);
            await this.sleep(j * 1000);
            break;
          } else {
            console.log(`   ⏳ ${j} seconds remaining...`);
            await this.sleep(10000);
          }
        }
      }
    }

    // Generate comprehensive analysis
    const analysis = this.analyzeServiceResults(results, overallSuccess);

    // Save detailed results
    const reportName = `service-load-test-2000conn-60s-${Date.now()}.json`;
    const reportData = {
      timestamp: new Date().toISOString(),
      testConfiguration: {
        connections: 1500,
        duration: 60,
        targetRPS: 1500,
      },
      results,
      analysis,
      overallSuccess,
    };

    writeFileSync(reportName, JSON.stringify(reportData, null, 2));

    console.log(`\n💾 Detailed test results saved: ${reportName}`);
    this.displayServiceResults(analysis, overallSuccess);

    return analysis;
  }

  analyzeServiceResults(results, overallSuccess) {
    const successfulTests = results.filter((r) => r.success);

    // Calculate service-specific metrics
    const serviceMetrics = results.map((result) => ({
      serviceName: result.testName,
      rps: result.rps || 0,
      rpsEfficiency: result.rps
        ? ((result.rps / 1500) * 100).toFixed(1)
        : "0.0",
      successRate: result.reliability?.successRate || 0,
      avgLatency: result.latency?.average || 0,
      p99Latency: result.latency?.p99 || 0,
      totalRequests: result.throughput?.totalRequests || 0,
      errors: result.reliability?.errors || 0,
      passed: result.success,
    }));

    // Overall statistics
    const totalRPS = serviceMetrics.reduce(
      (sum, metric) => sum + metric.rps,
      0
    );
    const avgSuccessRate =
      serviceMetrics.reduce((sum, metric) => sum + metric.successRate, 0) /
      serviceMetrics.length;
    const avgLatency =
      serviceMetrics.reduce((sum, metric) => sum + metric.avgLatency, 0) /
      serviceMetrics.length;

    return {
      summary: {
        totalTests: results.length,
        successfulTests: successfulTests.length,
        overallSuccess,
        totalCombinedRPS: totalRPS,
        averageSuccessRate: avgSuccessRate,
        averageLatency: avgLatency,
        targetRPSPerService: 1500,
        targetRPSOverall: 8000, // 4 services × 1500 RPS each
      },
      serviceMetrics,
      architecture: {
        type: "microservices-with-shared-prisma",
        readReplicaLoadBalancing: "automatic",
        connectionPooling: "prisma-managed",
        replicaCount: 4,
        strategy: "round-robin",
        dataFlow: "gateway → microservices → shared-prisma → read-replicas",
      },
    };
  }

  displayServiceResults(analysis, overallSuccess) {
    console.log("\n📊 INDIVIDUAL SERVICE LOAD TEST RESULTS");
    console.log("=".repeat(70));

    console.log(
      `\n🎯 OVERALL STATUS: ${
        overallSuccess ? "✅ SUCCESS" : "❌ PARTIAL FAILURE"
      }`
    );
    console.log(`📈 Combined System RPS: ${analysis.summary.totalCombinedRPS}`);
    console.log(
      `📊 Average Success Rate: ${analysis.summary.averageSuccessRate.toFixed(
        1
      )}%`
    );
    console.log(
      `⏱️ Average Latency: ${analysis.summary.averageLatency.toFixed(1)}ms`
    );

    console.log(`\n📋 SERVICE PERFORMANCE BREAKDOWN:`);
    console.log(
      "┌─────────────────────────────┬─────────┬──────────┬──────────┬─────────┬────────┐"
    );
    console.log(
      "│ Service                     │   RPS   │ Target % │ Success% │ Avg Lat │ Status │"
    );
    console.log(
      "├─────────────────────────────┼─────────┼──────────┼──────────┼─────────┼────────┤"
    );

    analysis.serviceMetrics.forEach((metric) => {
      const serviceName = metric.serviceName.split(" ")[0].padEnd(27);
      const rps = metric.rps.toString().padStart(7);
      const efficiency = `${metric.rpsEfficiency}%`.padStart(8);
      const successRate = `${metric.successRate.toFixed(1)}%`.padStart(8);
      const latency = `${metric.avgLatency.toFixed(0)}ms`.padStart(7);
      const status = metric.passed ? "✅ PASS" : "❌ FAIL";

      console.log(
        `│ ${serviceName} │ ${rps} │ ${efficiency} │ ${successRate} │ ${latency} │ ${status} │`
      );
    });

    console.log(
      "└─────────────────────────────┴─────────┴──────────┴──────────┴─────────┴────────┘"
    );
  }
}

// Usage
const tester = new PrismaReplicaLoadTester();

// Run the individual service load tests
tester.runServiceLoadTests();

export default PrismaReplicaLoadTester;
