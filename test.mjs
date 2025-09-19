import autocannon from "autocannon";
import { writeFileSync } from "fs";
import axios from "axios";

class ReplicaLoadTester {
  constructor() {
    this.baseUrl = "http://localhost:3000";
    this.poolServiceUrl = "http://localhost:3004";

    this.testConfig = {
      endpoint: "/user/123/dashboard/01",
      headers: {
        "x-country": "india",
        "x-resource": "customer",
        "Content-Type": "application/json",
        Connection: "keep-alive",
      },
    };

    this.coolDownConfig = {
      betweenTests: 60000,
      afterFailure: 60000,
      beforeCleanup: 6000,
      afterCleanup: 5000,
      poolStabilization: 60000,
    };
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getPoolStats() {
    try {
      const response = await axios.get(`${this.poolServiceUrl}/stats`);
      return response.data;
    } catch (error) {
      console.warn(`[TEST] Could not get pool stats: ${error.message}`);
      return null;
    }
  }

  async waitForPoolStabilization(maxWaitTime = 30000) {
    console.log(`[TEST] Waiting for pool stabilization...`);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const stats = await this.getPoolStats();

      if (stats && stats.global) {
        const { activeConnections, totalConnections } = stats.global;
        console.log(
          `Pool: Total: ${totalConnections}, Active: ${activeConnections}`
        );

        // Show replica distribution if available
        if (stats.loadBalancer?.replicaDistribution) {
          const replicaInfo = Object.entries(
            stats.loadBalancer.replicaDistribution
          )
            .filter(([_, count]) => count > 0)
            .map(([replica, count]) => `${replica.split("_").pop()}:${count}`)
            .join(", ");
          if (replicaInfo) {
            console.log(`Replicas: ${replicaInfo}`);
          }
        }

        // Pool is stable when active connections are reasonable
        if (activeConnections <= 20) {
          console.log(`[TEST] Pool stabilized`);
          return true;
        }
      }

      await this.sleep(2000);
    }

    console.warn(`[TEST] Pool stabilization timeout`);
    return false;
  }

  async runSingleTest(testConfig, resetBefore = false) {
    const { name, connections, duration, expectedRPS } = testConfig;

    console.log(
      `\n🚀 [TEST] Starting ${name} test (${connections} connections, ${duration}s)`
    );

    try {
      if (resetBefore) {
        console.log(`[TEST] Resetting system state...`);
        await this.sleep(this.coolDownConfig.beforeCleanup);
        await this.waitForPoolStabilization();
      }

      // Get baseline stats
      const beforeStats = await this.getPoolStats();

      // Run the load test
      const startTime = Date.now();
      const result = await autocannon({
        url: `${this.baseUrl}${this.testConfig.endpoint}`,
        connections: connections,
        duration: duration,
        headers: this.testConfig.headers,
        timeout: Math.max(20, duration * 1.5),
        connectionTimeout: 10,
        renderProgressBar: false,
        renderLatencyTable: false,
        renderResultsTable: false,
      });

      const testDuration = Date.now() - startTime;

      // Get post-test stats
      const afterStats = await this.getPoolStats();

      // Calculate metrics
      const metrics = {
        testName: name,
        connections,
        duration: testDuration,
        rps: Math.round(result.requests?.average || 0),
        expectedRPS,
        latency: {
          average: result.latency?.average || 0,
          p99: result.latency?.p99 || 0,
        },
        reliability: {
          successRate:
            ((result["2xx"] || 0) / (result.requests?.total || 1)) * 100,
          errors: result.errors || 0,
          timeouts: result.timeouts || 0,
          totalRequests: result.requests?.total || 0,
        },
        poolStats: {
          before: beforeStats,
          after: afterStats,
          connectionGrowth:
            (afterStats?.global?.totalConnections || 0) -
            (beforeStats?.global?.totalConnections || 0),
        },
        loadBalancing: {
          beforeDistribution:
            beforeStats?.loadBalancer?.replicaDistribution || {},
          afterDistribution:
            afterStats?.loadBalancer?.replicaDistribution || {},
          healthyReplicas: afterStats?.loadBalancer?.healthyReplicas || 0,
          readWriteRatio:
            afterStats?.global?.readRequests &&
            afterStats?.global?.writeRequests
              ? `${(
                  afterStats.global.readRequests /
                  afterStats.global.writeRequests
                ).toFixed(1)}:1`
              : "All reads",
        },
      };

      // Determine success
      const isSuccess =
        metrics.reliability.successRate > 95 && metrics.reliability.errors < 10;

      console.log(
        `   📊 Results: ${
          metrics.rps
        } RPS (target: ${expectedRPS}), ${metrics.reliability.successRate.toFixed(
          1
        )}% success`
      );
      console.log(
        `   🔗 Pool growth: ${metrics.poolStats.connectionGrowth}, Healthy replicas: ${metrics.loadBalancing.healthyReplicas}`
      );

      if (
        metrics.loadBalancing.afterDistribution &&
        Object.keys(metrics.loadBalancing.afterDistribution).length > 1
      ) {
        const replicaUsage = Object.entries(
          metrics.loadBalancing.afterDistribution
        )
          .filter(([_, count]) => count > 0)
          .map(([replica, count]) => `${replica.split("_").pop()}:${count}`)
          .join(", ");
        console.log(`   🎯 Load balanced: ${replicaUsage}`);
      }

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
        connections,
        error: error.message,
        success: false,
        crashed: true,
      };
    }
  }

  async runReplicaLoadTest() {
    console.log("🎯 REPLICA LOAD BALANCING TEST - 800 RPS TARGET");
    console.log("=".repeat(70));

    // Test configurations optimized for replica load balancing
    const testLevels = [
      {
        name: "Baseline",
        connections: 300,
        duration: 15,
        expectedRPS: 2000,
        resetBefore: false,
      },
      {
        name: "Light Load",
        connections: 800,
        duration: 15,
        expectedRPS: 2000,
        resetBefore: false,
      },
      {
        name: "Medium Load",
        connections: 1200,
        duration: 15,
        expectedRPS: 2000,
        resetBefore: false,
      },
      {
        name: "Heavy Load",
        connections: 1500,
        duration: 15,
        expectedRPS: 2000,
        resetBefore: false,
      },
      {
        name: "Extreme Load",
        connections: 2000,
        duration: 15,
        expectedRPS: 2000,
        resetBefore: false,
      },
    ];

    const results = [];
    let lastSuccessfulLevel = null;
    let targetAchieved = false;

    for (let i = 0; i < testLevels.length; i++) {
      const level = testLevels[i];

      const result = await this.runSingleTest(level, level.resetBefore);
      results.push(result);

      if (result.success) {
        lastSuccessfulLevel = result;
        console.log(
          `✅ Successfully handled ${level.connections} connections (${result.rps} RPS)`
        );

        // Check if we've achieved our 800 RPS target
        if (result.rps >= 800 && !targetAchieved) {
          targetAchieved = true;
          console.log(
            `🎉 TARGET ACHIEVED: ${result.rps} RPS with ${level.connections} connections!`
          );
        }
      } else {
        console.log(`❌ Failed at ${level.connections} connections`);
      }

      // Cool down between tests
      if (i < testLevels.length - 1) {
        const coolDownTime = result.success
          ? this.coolDownConfig.betweenTests / 1000
          : this.coolDownConfig.afterFailure / 1000;

        console.log(`😴 [TEST] Cooling down for ${coolDownTime} seconds...`);
        await this.sleep(coolDownTime * 1000);

        if (!result.success) {
          await this.waitForPoolStabilization();
        }
      }

      // Stop if we hit severe failures
      if (!result.success && result.reliability?.successRate < 50) {
        console.log(`🛑 Stopping tests - Success rate too low`);
        break;
      }
    }

    // Generate analysis
    const analysis = this.analyzeReplicaResults(
      results,
      lastSuccessfulLevel,
      targetAchieved
    );

    // Save results
    const reportName = `replica-load-test-${Date.now()}.json`;
    writeFileSync(
      reportName,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          testType: "REPLICA_LOAD_BALANCING_TEST",
          target: "800_RPS",
          targetAchieved,
          results,
          analysis,
        },
        null,
        2
      )
    );

    console.log(`\n💾 Test results saved: ${reportName}`);
    this.displayReplicaResults(analysis, targetAchieved, lastSuccessfulLevel);

    return analysis;
  }

  analyzeReplicaResults(results, lastSuccess, targetAchieved) {
    const successfulTests = results.filter((r) => r.success);
    const maxRPS = Math.max(...results.map((r) => r.rps || 0));

    return {
      summary: {
        totalTests: results.length,
        successfulTests: successfulTests.length,
        targetAchieved,
        maxRPSAchieved: maxRPS,
        maxSuccessfulConnections: lastSuccess?.connections || 0,
        maxSuccessfulRPS: lastSuccess?.rps || 0,
      },

      replicaPerformance: {
        loadBalancingEffective: results.some(
          (r) => r.loadBalancing?.healthyReplicas > 1
        ),
        replicaUtilization: this.analyzeReplicaUtilization(results),
        readWritePattern:
          lastSuccess?.loadBalancing?.readWriteRatio || "Unknown",
      },

      recommendations: this.generateReplicaRecommendations(
        results,
        targetAchieved,
        maxRPS
      ),
    };
  }

  analyzeReplicaUtilization(results) {
    const lastResult = results[results.length - 1];
    if (!lastResult?.loadBalancing?.afterDistribution) {
      return "No replica data available";
    }

    const distribution = lastResult.loadBalancing.afterDistribution;
    const total = Object.values(distribution).reduce(
      (sum, count) => sum + count,
      0
    );

    if (total === 0) return "No requests distributed";

    const replicaCount = Object.keys(distribution).length;
    const avgPerReplica = total / replicaCount;
    const variance =
      Object.values(distribution).reduce(
        (sum, count) => sum + Math.pow(count - avgPerReplica, 2),
        0
      ) / replicaCount;

    return {
      totalRequests: total,
      replicaCount,
      averagePerReplica: Math.round(avgPerReplica),
      loadBalance:
        variance < avgPerReplica ? "Well balanced" : "Uneven distribution",
      distribution,
    };
  }

  generateReplicaRecommendations(results, targetAchieved, maxRPS) {
    const recommendations = [];

    if (targetAchieved) {
      recommendations.push("🎉 SUCCESS: 800 RPS target achieved!");
      recommendations.push(`✅ Maximum RPS: ${maxRPS}`);
      recommendations.push(
        "✅ Read replica load balancing is working effectively"
      );
    } else {
      recommendations.push("⚠️ 800 RPS target NOT achieved");
      recommendations.push(`📊 Maximum achieved: ${maxRPS} RPS`);
    }

    // Analyze failure patterns
    const failedTests = results.filter((r) => !r.success);
    if (failedTests.length > 0) {
      const highestFailedConnections = Math.max(
        ...failedTests.map((r) => r.connections)
      );
      recommendations.push(
        `🔍 System breaks at ${highestFailedConnections} concurrent connections`
      );

      // Check for pool exhaustion
      const poolExhaustionTests = failedTests.filter(
        (r) => r.poolStats?.connectionGrowth > 200
      );
      if (poolExhaustionTests.length > 0) {
        recommendations.push("🏊‍♂️ CONNECTION POOL OPTIMIZATION NEEDED:");
        recommendations.push(
          "  • Increase max connections per replica to 100+"
        );
        recommendations.push("  • Consider adding more read replicas");
        recommendations.push(
          "  • Implement connection pooling middleware (PgBouncer)"
        );
      }
    }

    // Performance optimization suggestions
    if (maxRPS < 1200) {
      recommendations.push("🚀 SCALE UP OPPORTUNITIES:");
      recommendations.push("  • Add more read replicas for higher capacity");
      recommendations.push("  • Optimize database queries and indexes");
      recommendations.push("  • Consider horizontal scaling");
    }

    return recommendations;
  }

  displayReplicaResults(analysis, targetAchieved, lastSuccess) {
    console.log("\n📊 REPLICA LOAD BALANCING TEST RESULTS");
    console.log("=".repeat(60));

    console.log(
      `\n🎯 TARGET STATUS: ${
        targetAchieved ? "✅ ACHIEVED" : "❌ NOT ACHIEVED"
      }`
    );
    console.log(`📈 Maximum RPS: ${analysis.summary.maxRPSAchieved}`);
    console.log(
      `⚡ Max Stable Load: ${analysis.summary.maxSuccessfulConnections} connections`
    );

    if (analysis.replicaPerformance.loadBalancingEffective) {
      console.log(`\n🎯 LOAD BALANCING: ✅ ACTIVE`);
      if (analysis.replicaPerformance.replicaUtilization.distribution) {
        console.log(`📊 Replica Usage:`);
        for (const [replica, count] of Object.entries(
          analysis.replicaPerformance.replicaUtilization.distribution
        )) {
          if (count > 0) {
            console.log(`   ${replica}: ${count} requests`);
          }
        }
      }
    } else {
      console.log(`\n🎯 LOAD BALANCING: ❌ NOT DETECTED`);
    }

    console.log(`\n💡 RECOMMENDATIONS:`);
    analysis.recommendations.forEach((rec) => console.log(`   ${rec}`));

    if (targetAchieved) {
      console.log(`\n🏆 CONCLUSION: System ready for 800 RPS production load!`);
    } else {
      console.log(
        `\n⚙️ CONCLUSION: System needs optimization to reach 800 RPS target.`
      );
    }
  }

  // Quick test for replica verification
  async runQuickReplicaTest() {
    console.log("🔧 QUICK REPLICA VERIFICATION TEST");
    console.log("=".repeat(40));

    const result = await this.runSingleTest(
      {
        name: "Quick Replica Test",
        connections: 20,
        duration: 10,
        expectedRPS: 200,
      },
      false
    );

    console.log(`\n🎯 Quick Test Results:`);
    console.log(`   RPS: ${result.rps}`);
    console.log(
      `   Success Rate: ${result.reliability?.successRate.toFixed(1)}%`
    );
    console.log(
      `   Healthy Replicas: ${result.loadBalancing?.healthyReplicas || 0}`
    );

    if (result.loadBalancing?.afterDistribution) {
      console.log(`   Replica Distribution:`);
      for (const [replica, count] of Object.entries(
        result.loadBalancing.afterDistribution
      )) {
        if (count > 0) {
          console.log(`     ${replica}: ${count} requests`);
        }
      }
    }

    return result;
  }
}

// Usage
const tester = new ReplicaLoadTester();

// For full replica load test targeting 800 RPS
tester.runReplicaLoadTest();

// For quick verification
// tester.runQuickReplicaTest();

export default ReplicaLoadTester;
