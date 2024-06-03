const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers, upgrades, network } = require("hardhat");

async function createPermit(contract, signer, id, amount, receiver, deadline) {
  const msgParams = {
    types: {
      Beneficiary: [
        { name: "id", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "receiver", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    },
    domain: {
      name: "Escrow",
      version: "1",
      chainId: network.config.chainId,
      verifyingContract: contract,
    },
    values: {
      id,
      amount,
      receiver,
      deadline,
    },
  };

  return await signer.signTypedData(
    msgParams.domain,
    msgParams.types,
    msgParams.values
  );
}

describe("Escrow", () => {
  async function deployEscrowFixture() {
    // Deploy the token first
    const [deployer, beneficiary, user3, user4] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("Token");
    let token = await Token.deploy("XToken", "XTK", 18);

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

    await token.faucet(ethers.parseUnits("1000", 18));
    await token.approve(
      await escrow.getAddress(),
      ethers.parseUnits("1000", 18)
    );

    return { token, beacon, escrow, deployer, beneficiary, user3, user4 };
  }

  describe("DepositTokens", () => {
    it("should revert if invalid beneficiary hash", async () => {
      const { escrow, token } = await loadFixture(deployEscrowFixture);
      const zeroHash = ethers.ZeroHash;

      await expect(
        escrow.depositToken(token, zeroHash, 10)
      ).to.be.revertedWithCustomError(escrow, "InvalidBeneficiaryHash");
    });
    it("should revert if not pass token amount and eth", async () => {
      const { token, escrow, user3 } = await loadFixture(deployEscrowFixture);

      const user3Hash = ethers.solidityPackedKeccak256(
        ["address"],
        [user3.address]
      );

      await expect(
        escrow.depositToken(token, user3Hash, 0, { value: 0 })
      ).to.be.revertedWithCustomError(escrow, "InvalidInput");
    });
    it("Deployer should be able to deposit tokens and ETH", async () => {
      let amount = ethers.parseUnits("100", 18);
      const { token, escrow, deployer, beneficiary } = await loadFixture(
        deployEscrowFixture
      );

      let beneficiaryHash = ethers.solidityPackedKeccak256(
        ["address"],
        [beneficiary.address]
      );

      const tx = await escrow
        .connect(deployer)
        .depositToken(token, beneficiaryHash, amount);

      expect(await escrow.counterId()).to.be.equals(1);
      await expect(tx)
        .to.emit(escrow, "Deposited")
        .withArgs(1, deployer.address);

      const deposit1 = await escrow.idToBeneficiaryMap(1);

      expect(deposit1.amount).to.be.equals(ethers.parseUnits("100", 18));
      expect(deposit1.beneficiaryHash).to.be.hexEqual(beneficiaryHash);
      expect(deposit1.isToken).to.be.true;
      expect(deposit1.isReleased).to.be.false;

      const tx2 = await escrow
        .connect(deployer)
        .depositToken(ethers.ZeroAddress, beneficiaryHash, 0, {
          value: ethers.parseEther("5"),
        });

      await expect(tx2)
        .to.emit(escrow, "Deposited")
        .withArgs(2, deployer.address);

      const deposit2 = await escrow.idToBeneficiaryMap(2);
      expect(deposit2.amount).to.be.equals(ethers.parseUnits("5", 18));
      expect(deposit2.beneficiaryHash).to.be.hexEqual(beneficiaryHash);
      expect(deposit2.token).to.be.equals(ethers.ZeroAddress);
      expect(deposit2.isToken).to.be.false;
      expect(deposit2.isReleased).to.be.false;
    });
  });

  describe("ReleaseFund", () => {
    it("Should revert if receiver passed invalid signature", async () => {
      const { escrow, beneficiary, deployer, token, user4 } = await loadFixture(
        deployEscrowFixture
      );
      let amount = ethers.parseUnits("100", 18);
      let beneficiaryHash = ethers.solidityPackedKeccak256(
        ["address"],
        [beneficiary.address]
      );
      const escrowAddress = await escrow.getAddress();

      const tx = await escrow
        .connect(deployer)
        .depositToken(token, beneficiaryHash, amount);

      const deposit1 = await escrow.idToBeneficiaryMap(1);

      expect(await token.balanceOf(escrowAddress)).to.be.equals(
        ethers.parseUnits("100", 18)
      );

      let receiverBalance;
      receiverBalance = await token.balanceOf(user4.address);

      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
      const deadline = timestamp + 1000;

      const sig = await createPermit(
        escrowAddress,
        beneficiary,
        1,
        amount,
        user4.address,
        0
      );
      let BeneficiaryInfo = {
        id: 1,
        amount: amount,
        receiver: user4.address,
        deadline: deadline,
      };

      await expect(
        escrow.connect(user4).releaseFund(sig, BeneficiaryInfo)
      ).to.be.revertedWithCustomError(escrow, "SignatureInvalid");
    });
    it("Receiver should be able to release tokens with valid Signature", async () => {
      const { escrow, beneficiary, deployer, token, user4 } = await loadFixture(
        deployEscrowFixture
      );
      let amount = ethers.parseUnits("100", 18);
      let beneficiaryHash = ethers.solidityPackedKeccak256(
        ["address"],
        [beneficiary.address]
      );
      const escrowAddress = await escrow.getAddress();

      const tx = await escrow
        .connect(deployer)
        .depositToken(token, beneficiaryHash, amount);

      const deposit1 = await escrow.idToBeneficiaryMap(1);

      expect(await escrow.counterId()).to.be.equals(1);
      expect(deposit1.amount).to.be.equals(ethers.parseUnits("100", 18));
      expect(deposit1.beneficiaryHash).to.be.hexEqual(beneficiaryHash);
      expect(deposit1.isToken).to.be.true;
      expect(deposit1.token).to.be.hexEqual(await token.getAddress());

      expect(await token.balanceOf(escrowAddress)).to.be.equals(
        ethers.parseUnits("100", 18)
      );

      let receiverBalance;
      receiverBalance = await token.balanceOf(user4.address);

      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
      const deadline = timestamp + 1000;

      const sig = await createPermit(
        escrowAddress,
        beneficiary,
        1,
        amount,
        user4.address,
        deadline
      );
      let BeneficiaryInfo = {
        id: 1,
        amount: amount,
        receiver: user4.address,
        deadline: deadline,
      };

      const tx1 = await escrow.connect(user4).releaseFund(sig, BeneficiaryInfo);

      receiverBalance = await token.balanceOf(user4.address);

      expect(await token.balanceOf(user4.address)).to.be.equals(
        ethers.parseUnits("100", 18)
      );
    });

    it("Receiver should be able to release ETH with valid Signature", async () => {
      const { escrow, beneficiary, deployer, token, user3, user4 } =
        await loadFixture(deployEscrowFixture);
      let amount = ethers.parseEther("4");
      let beneficiaryHash = ethers.solidityPackedKeccak256(
        ["address"],
        [beneficiary.address]
      );
      const escrowAddress = await escrow.getAddress();

      const tx = await escrow
        .connect(deployer)
        .depositToken(ethers.ZeroAddress, beneficiaryHash, 0, {
          value: amount,
        });

      const deposit1 = await escrow.idToBeneficiaryMap(1);

      expect(await escrow.counterId()).to.be.equals(1);
      expect(deposit1.amount).to.be.equals(ethers.parseUnits("4", 18));
      expect(deposit1.beneficiaryHash).to.be.hexEqual(beneficiaryHash);
      expect(deposit1.isToken).to.be.false;
      expect(deposit1.token).to.be.hexEqual(ethers.ZeroAddress);

      let escrowETHBalance = await ethers.provider.getBalance(escrowAddress);

      expect(escrowETHBalance).to.be.equals(ethers.parseUnits("4", 18));

      let previousBalance;
      previousBalance = await ethers.provider.getBalance(user4.address);

      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
      const deadline = timestamp + 1000;

      const sig = await createPermit(
        escrowAddress,
        beneficiary,
        1,
        amount,
        user4.address,
        deadline
      );
      let BeneficiaryInfo = {
        id: 1,
        amount: amount,
        receiver: user4.address,
        deadline: deadline,
      };

      const tx1 = await escrow.connect(user3).releaseFund(sig, BeneficiaryInfo);

      let afterBalance;
      afterBalance = await ethers.provider.getBalance(user4.address);

      expect(afterBalance - previousBalance).to.be.equals(amount);
    });
  });

  describe("Ownership", () => {
    it("Should revert if non owner withdraw token", async () => {
      const { escrow, token, deployer, user3 } = await loadFixture(
        deployEscrowFixture
      );

      await expect(
        escrow.connect(user3).withdrawTokens(token)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("Should revert if non owner withdraw eth", async () => {
      const { escrow, token, deployer, user3 } = await loadFixture(
        deployEscrowFixture
      );

      await expect(
        escrow.connect(user3).withdrawETH()
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("Owner should be able to withdraw ETH", async () => {
      const { escrow, deployer, user4 } = await loadFixture(
        deployEscrowFixture
      );
      const escrowAddress = await escrow.getAddress();

      const tx = await user4.sendTransaction({
        to: escrowAddress,
        value: ethers.parseEther("5"),
      });

      let deployerBalanceBefore = await ethers.provider.getBalance(
        deployer.address
      );

      let contractBalance = await ethers.provider.getBalance(escrowAddress);

      await expect(escrow.connect(deployer).withdrawETH())
        .to.emit(escrow, "WithdrawETH")
        .withArgs(deployer.address, contractBalance);

      contractBalance = await ethers.provider.getBalance(escrowAddress);

      let deployerBalanceAfter = await ethers.provider.getBalance(
        deployer.address
      );

      expect(
        deployerBalanceAfter - deployerBalanceBefore
      ).to.be.lessThanOrEqual(ethers.parseEther("5"));
    });

    it("Owner should be able to withdraw Token", async () => {
      const { escrow, token, deployer, user4 } = await loadFixture(
        deployEscrowFixture
      );
      let amount = ethers.parseUnits("100", 18);
      const escrowAddress = await escrow.getAddress();
      await token.connect(user4).faucet(amount);
      expect(await token.balanceOf(user4.address)).to.be.equals(amount);
      await token.transfer(escrowAddress, amount);
      await expect(escrow.connect(deployer).withdrawTokens(token))
        .to.emit(escrow, "WithdrawToken")
        .withArgs(deployer.address, amount);
    });
  });
});
