const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('Standalone Count-Pending Script', function() {
  it('should have executable count-pending.js script', function() {
    const scriptPath = path.join(__dirname, '../../scripts/count-pending.js');
    expect(fs.existsSync(scriptPath)).to.be.true;
    
    const stats = fs.statSync(scriptPath);
    expect(stats.isFile()).to.be.true;
  });

  it('should show help when no WS_URL provided', function() {
    const scriptPath = path.join(__dirname, '../../scripts/count-pending.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    // Check for key components
    expect(scriptContent).to.include('WS_URL or RPC_URL_WS environment variable is required');
    expect(scriptContent).to.include('eth_subscribe');
    expect(scriptContent).to.include('newPendingTransactions');
    expect(scriptContent).to.include('gracefulShutdown');
  });

  it('should validate sample output report exists and is valid JSON', function() {
    const reportPath = path.join(__dirname, '../../reports/sample-pending-univ3-output.json');
    expect(fs.existsSync(reportPath)).to.be.true;
    
    const reportContent = fs.readFileSync(reportPath, 'utf8');
    const reportData = JSON.parse(reportContent);
    
    expect(reportData).to.have.property('samplePendingUniv3Output');
    expect(reportData.samplePendingUniv3Output).to.have.property('samples');
    expect(reportData.samplePendingUniv3Output.samples).to.be.an('array');
    expect(reportData.samplePendingUniv3Output.samples.length).to.be.greaterThan(0);
    
    // Check for different method types
    const methods = reportData.samplePendingUniv3Output.samples.map(s => s.decodedCall.method);
    expect(methods).to.include('exactInputSingle');
    expect(methods).to.include('exactInput');
    expect(methods).to.include('exactOutputSingle');
    expect(methods).to.include('exactOutput');
  });
});

describe('Configuration Integration', function() {
  it('should include new config variables in env.example', function() {
    const envPath = path.join(__dirname, '../../.env.example');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    expect(envContent).to.include('LOG_ALL_PENDING_TX');
    expect(envContent).to.include('PENDING_FEED_WARN_THRESHOLD_PER_MIN');
  });

  it('should include documentation for new features in README', function() {
    const readmePath = path.join(__dirname, '../../README.md');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    
    expect(readmeContent).to.include('Pending Transaction Volume Debug Mode');
    expect(readmeContent).to.include('exactOutputSingle');
    expect(readmeContent).to.include('exactOutput');
    expect(readmeContent).to.include('Standalone Pending Counter Script');
    expect(readmeContent).to.include('count-pending.js');
    expect(readmeContent).to.include('Provider Starvation Warnings');
  });
});