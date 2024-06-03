
# Escrow Upgradeable Smart Contract

Two Parties Depositer and Beneficiary

 1.The depositor sends an arbitrary ERC20 or ETH to the smart contract & 
 provides information about the beneficiary address which can release the funds. 
 
 2.The beneficiary address should remain hidden until the funds are released.
 Hashing the address is enough.

3.The beneficiary signs the release funds order off-chain and any address can submit it to the chain. 

4.The funds should be released to the address provided by the beneficiary.

5.The escrow contract should handle multiple depositors and beneficiaries. 
There is always only one beneficiary for the given deposit.

