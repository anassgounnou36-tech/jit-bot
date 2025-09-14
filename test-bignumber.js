const { ethers } = require('ethers');
const { expect } = require('chai');

// Test BigNumber comparison
const a = ethers.BigNumber.from(0);
const b = ethers.BigNumber.from(0);

console.log('Testing BigNumber comparison:');
console.log('a:', a);
console.log('b:', b);
console.log('a._hex:', a._hex);
console.log('b._hex:', b._hex);
console.log('a === b:', a === b);
console.log('a.eq(b):', a.eq(b));

try {
  expect(a).to.equal(b);
  console.log('Chai .to.equal() worked!');
} catch (e) {
  console.log('Chai .to.equal() failed:', e.message);
}

try {
  expect(a.eq(b)).to.be.true;
  console.log('Chai .eq() pattern worked!');
} catch (e) {
  console.log('Chai .eq() pattern failed:', e.message);
}