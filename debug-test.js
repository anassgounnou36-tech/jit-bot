// Debug test to understand BigNumber comparison issue
const { ethers } = require('ethers');
const { expect } = require('chai');

// Create constants as the test does
const ZERO_A = ethers.BigNumber.from(0);
const ZERO_B = ethers.BigNumber.from(0);
const ZERO_CONST = ethers.constants.Zero;

console.log('Testing different zero BigNumbers:');
console.log('ZERO_A:', ZERO_A);
console.log('ZERO_B:', ZERO_B);
console.log('ZERO_CONST:', ZERO_CONST);

console.log('\nIdentity checks:');
console.log('ZERO_A === ZERO_B:', ZERO_A === ZERO_B);
console.log('ZERO_A === ZERO_CONST:', ZERO_A === ZERO_CONST);
console.log('ZERO_B === ZERO_CONST:', ZERO_B === ZERO_CONST);

console.log('\nValue checks:');
console.log('ZERO_A.eq(ZERO_B):', ZERO_A.eq(ZERO_B));
console.log('ZERO_A.eq(ZERO_CONST):', ZERO_A.eq(ZERO_CONST));

// Simulate what the test does
class MockAdapter {
  async calculateFlashloanFee() {
    return ethers.BigNumber.from(0);
  }
}

const adapter = new MockAdapter();
adapter.calculateFlashloanFee = async () => ethers.BigNumber.from(0);

async function testFlow() {
  const fee = await adapter.calculateFlashloanFee();
  const expected = ethers.BigNumber.from(0);
  
  console.log('\nTest simulation:');
  console.log('fee:', fee);
  console.log('expected:', expected);
  console.log('fee === expected:', fee === expected);
  console.log('fee.eq(expected):', fee.eq(expected));
  
  try {
    expect(fee).to.equal(expected);
    console.log('Chai .to.equal() passed!');
  } catch (e) {
    console.log('Chai .to.equal() failed:', e.message);
  }
}

testFlow();