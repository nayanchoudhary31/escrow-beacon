const { ethers, upgrades } = require("hardhat");
async function main() {
  const [deployer, beneficiary, receiver] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("Token");
  const token = await Token.deploy("XToken", "XTK", 18);

  console.log(`Token Deployed to the address ${await token.getAddress()}`);
  const Escrow = await ethers.getContractFactory("Escrow");
  let beacon = await upgrades.deployBeacon(Escrow, {
    unsafeAllow: ["constructor"],
  });
  beacon.waitForDeployment();
  console.log(`Beacon Deployed to the address ${await beacon.getAddress()}`);
  let escrow = await upgrades.deployBeaconProxy(beacon, Escrow, [], {
    initializer: "initialize",
  });
  escrow.waitForDeployment();
  console.log(`Escrow Deployed to the address ${await escrow.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
