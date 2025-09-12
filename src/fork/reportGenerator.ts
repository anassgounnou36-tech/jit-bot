import { ethers } from "ethers";
import * as fs from "fs";

export interface ReportData {
  pool: string;
  blockNumber: number;
  swapSize: string;
  amountIn: string;
  tokenIn: string;
  profitable: boolean;
  netProfitEth: ethers.BigNumber;
  netProfitUsdc?: number;
  gasUsed: number;
  gasCostEth: ethers.BigNumber;
  lpFeesEth: ethers.BigNumber;
  reason?: string;
}

export interface Summary {
  totalSimulations: number;
  profitableCount: number;
  totalProfitEth: ethers.BigNumber;
  totalProfitUsdc: number;
  averageGasUsed: number;
  bestPool: string;
  bestSwapSize: string;
  timestamp: string;
}

export class ReportGenerator {
  
  async generateJsonReport(results: ReportData[], outputPath: string): Promise<void> {
    const timestamp = new Date().toISOString();
    
    const report = {
      metadata: {
        timestamp,
        totalSimulations: results.length,
        profitableCount: results.filter(r => r.profitable).length,
        version: "1.0.0"
      },
      summary: this.generateSummary(results),
      results: results.map(result => ({
        ...result,
        netProfitEth: ethers.utils.formatEther(result.netProfitEth),
        gasCostEth: ethers.utils.formatEther(result.gasCostEth),
        lpFeesEth: ethers.utils.formatEther(result.lpFeesEth),
        profitabilityScore: this.calculateProfitabilityScore(result)
      }))
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`📄 JSON report generated: ${outputPath}`);
  }

  generateConsoleReport(results: ReportData[]): void {
    console.log("\n📊 Detailed Simulation Results");
    console.log("==============================");
    
    // Create table headers
    const headers = ['Pool', 'Swap Size', 'Amount', 'Profitable', 'Net Profit (ETH)', 'Net Profit (USD)', 'Gas Used', 'Reason'];
    const rows: string[][] = [];
    
    results.forEach(result => {
      const netProfitEth = ethers.utils.formatEther(result.netProfitEth);
      const netProfitUsdc = result.netProfitUsdc ? `$${result.netProfitUsdc.toFixed(2)}` : 'N/A';
      const profitable = result.profitable ? '✅ Yes' : '❌ No';
      
      rows.push([
        result.pool,
        result.swapSize,
        `${result.amountIn} ${result.tokenIn}`,
        profitable,
        `${netProfitEth}`,
        netProfitUsdc,
        result.gasUsed.toLocaleString(),
        result.reason || 'N/A'
      ]);
    });

    this.printTable(headers, rows);
  }

  generateSummary(results: ReportData[]): Summary {
    const profitableResults = results.filter(r => r.profitable);
    const totalProfitEth = results.reduce(
      (sum, r) => sum.add(r.netProfitEth.gt(0) ? r.netProfitEth : ethers.BigNumber.from(0)), 
      ethers.BigNumber.from(0)
    );
    const totalProfitUsdc = results.reduce(
      (sum, r) => sum + (r.netProfitUsdc && r.netProfitUsdc > 0 ? r.netProfitUsdc : 0), 
      0
    );

    const averageGasUsed = results.length > 0 
      ? Math.round(results.reduce((sum, r) => sum + r.gasUsed, 0) / results.length)
      : 0;

    // Find best performing pool and swap size
    const bestResult = results.reduce((best, current) => {
      if (!best || (current.netProfitUsdc || 0) > (best.netProfitUsdc || 0)) {
        return current;
      }
      return best;
    }, null as ReportData | null);

    return {
      totalSimulations: results.length,
      profitableCount: profitableResults.length,
      totalProfitEth,
      totalProfitUsdc,
      averageGasUsed,
      bestPool: bestResult?.pool || 'None',
      bestSwapSize: bestResult?.swapSize || 'None',
      timestamp: new Date().toISOString()
    };
  }

  private calculateProfitabilityScore(result: ReportData): number {
    if (!result.profitable) return 0;
    
    // Score based on profit margin and absolute profit
    const profitUsd = result.netProfitUsdc || 0;
    const amountUsd = parseFloat(result.amountIn) * 2000; // Rough ETH price conversion
    const profitMargin = profitUsd / amountUsd;
    
    // Score from 0-100 based on profit margin and absolute profit
    return Math.min(100, Math.round(profitMargin * 10000 + Math.sqrt(profitUsd)));
  }

  private printTable(headers: string[], rows: string[][]): void {
    // Calculate column widths
    const colWidths = headers.map((header, i) => {
      const headerWidth = header.length;
      const maxRowWidth = Math.max(...rows.map(row => (row[i] || '').toString().length));
      return Math.max(headerWidth, maxRowWidth, 10); // Minimum width of 10
    });

    // Print header
    const headerRow = headers.map((header, i) => header.padEnd(colWidths[i])).join(' | ');
    console.log(headerRow);
    console.log(colWidths.map(width => '-'.repeat(width)).join('-|-'));

    // Print rows
    rows.forEach(row => {
      const formattedRow = row.map((cell, i) => {
        const cellStr = (cell || '').toString();
        return cellStr.padEnd(colWidths[i]);
      }).join(' | ');
      console.log(formattedRow);
    });
  }

  generateCsvReport(results: ReportData[], outputPath: string): void {
    const headers = [
      'Pool',
      'Block Number',
      'Swap Size',
      'Amount In',
      'Token In',
      'Profitable',
      'Net Profit ETH',
      'Net Profit USD',
      'Gas Used',
      'Gas Cost ETH',
      'LP Fees ETH',
      'Reason'
    ];

    const csvRows = [
      headers.join(','),
      ...results.map(result => [
        result.pool,
        result.blockNumber,
        result.swapSize,
        result.amountIn,
        result.tokenIn,
        result.profitable,
        ethers.utils.formatEther(result.netProfitEth),
        result.netProfitUsdc || 0,
        result.gasUsed,
        ethers.utils.formatEther(result.gasCostEth),
        ethers.utils.formatEther(result.lpFeesEth),
        result.reason || ''
      ].map(field => `"${field}"`).join(','))
    ];

    fs.writeFileSync(outputPath, csvRows.join('\n'));
    console.log(`📄 CSV report generated: ${outputPath}`);
  }

  generateMarkdownReport(results: ReportData[], outputPath: string): void {
    const summary = this.generateSummary(results);
    
    let markdown = `# JIT LP Bot Simulation Report\n\n`;
    markdown += `**Generated:** ${summary.timestamp}\n\n`;
    
    markdown += `## Summary\n\n`;
    markdown += `- **Total Simulations:** ${summary.totalSimulations}\n`;
    markdown += `- **Profitable Scenarios:** ${summary.profitableCount} (${(summary.profitableCount / summary.totalSimulations * 100).toFixed(1)}%)\n`;
    markdown += `- **Total Potential Profit:** ${ethers.utils.formatEther(summary.totalProfitEth)} ETH (~$${summary.totalProfitUsdc.toFixed(2)})\n`;
    markdown += `- **Average Gas Used:** ${summary.averageGasUsed.toLocaleString()}\n`;
    markdown += `- **Best Performing Pool:** ${summary.bestPool}\n`;
    markdown += `- **Best Swap Size:** ${summary.bestSwapSize}\n\n`;
    
    markdown += `## Detailed Results\n\n`;
    markdown += `| Pool | Swap Size | Amount | Profitable | Net Profit (ETH) | Net Profit (USD) | Gas Used | Reason |\n`;
    markdown += `|------|-----------|--------|------------|------------------|------------------|----------|--------|\n`;
    
    results.forEach(result => {
      const profitable = result.profitable ? '✅' : '❌';
      const netProfitEth = ethers.utils.formatEther(result.netProfitEth);
      const netProfitUsdc = result.netProfitUsdc ? `$${result.netProfitUsdc.toFixed(2)}` : 'N/A';
      
      markdown += `| ${result.pool} | ${result.swapSize} | ${result.amountIn} ${result.tokenIn} | ${profitable} | ${netProfitEth} | ${netProfitUsdc} | ${result.gasUsed.toLocaleString()} | ${result.reason || 'N/A'} |\n`;
    });

    fs.writeFileSync(outputPath, markdown);
    console.log(`📄 Markdown report generated: ${outputPath}`);
  }
}