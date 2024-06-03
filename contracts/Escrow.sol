// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.22;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable, OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IERC20Token {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 value) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}

error InvalidInput();
error InvalidBeneficiaryHash();
error InvalidZeroAddress();
error SignatureExpired();
error SignatureInvalid();
error FundsAlreadyReleased();
error ETHTransferFailed();

/**
 * @title Escrow
 * @dev A contract for holding and releasing funds (ETH or ERC20 tokens) to beneficiaries based on signed messages.
 */
contract Escrow is Initializable, Ownable2StepUpgradeable, EIP712Upgradeable {
    using ECDSA for bytes32;

    /// @notice Counter for generating unique beneficiary IDs.
    uint256 public counterId;

    /**
     * @notice Structure to store beneficiary details.
     * @param id Unique identifier for the beneficiary.
     * @param amount Amount to be released to the beneficiary.
     * @param receiver Address to receive the funds.
     * @param deadline Time by which the signature is valid.
     */
    struct Beneficiary {
        uint256 id;
        uint256 amount;
        address receiver;
        uint256 deadline;
    }

    /**
     * @notice Structure to store detailed information about the beneficiary.
     * @param beneficiaryHash Hash of the beneficiary's address.
     * @param amount Amount to be released to the beneficiary.
     * @param token ERC20 token contract address.
     * @param isToken Boolean indicating if the fund is in token (true) or ETH (false).
     * @param isReleased Boolean indicating if the fund has already been released.
     */
    struct BeneficiaryDetails {
        bytes32 beneficiaryHash;
        uint256 amount;
        IERC20Token token;
        bool isToken;
        bool isReleased;
    }

    /// @notice Mapping from beneficiary ID to their detailed information.
    mapping(uint256 Id => BeneficiaryDetails) public idToBeneficiaryMap;

    /// @notice Mapping from beneficiary ID to their address.
    mapping(uint256 => address) public idToBeneficiary;

    /// @notice Event emitted when a deposit is made.
    /// @param id Unique identifier for the deposit.
    /// @param depositer Address of the depositor.
    event Deposited(uint256 indexed id, address indexed depositer);

    /// @notice Event emitted when funds are released.
    /// @param id Unique identifier for the beneficiary.
    /// @param beneficiary Address of the beneficiary.
    /// @param receiver Address receiving the funds.
    /// @param token Address of the ERC20 token, zero for ETH.
    /// @param amount Amount released.
    event FundReleased(
        uint256 indexed id,
        address indexed beneficiary,
        address receiver,
        address token,
        uint256 amount
    );

    /// @notice Event emitted when the owner withdraws ETH.
    /// @param owner Address of the owner.
    /// @param amount Amount of ETH withdrawn.
    event WithdrawETH(address indexed owner, uint256 indexed amount);

    /// @notice Event emitted when the owner withdraws tokens.
    /// @param owner Address of the owner.
    /// @param amount Amount of tokens withdrawn.
    event WithdrawToken(address indexed owner, uint256 indexed amount);

    /**
     * @dev Disable initializers to prevent unauthorized contract deployment.
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract.
     */
    function initialize() public initializer {
        __EIP712_init("Escrow", "1");
        __Ownable_init(msg.sender);
    }

    receive() external payable {}

    /**
     * @notice Deposit tokens or ETH to the contract.
     * @param _token Address of the ERC20 token contract.
     * @param _benificiaryHash Hash of the beneficiary's address.
     * @param amount Amount of tokens to deposit.
     */
    function depositToken(
        IERC20Token _token,
        bytes32 _benificiaryHash, // TODO: any bytes 32
        uint256 amount
    ) external payable {
        if (
            _benificiaryHash == keccak256(abi.encodePacked(address(0))) ||
            _benificiaryHash == bytes32(0)
        ) {
            revert InvalidBeneficiaryHash();
        }

        uint256 count = ++counterId;
        BeneficiaryDetails memory info;
        info.beneficiaryHash = _benificiaryHash;

        if (msg.value > 0) {
            info.amount = msg.value;
            info.isToken = false;
        } else if (amount > 0) {
            info.amount = amount;
            info.isToken = true;
            info.token = _token;
            _token.transferFrom(msg.sender, address(this), amount);
        } else {
            revert InvalidInput();
        }

        idToBeneficiaryMap[count] = info;

        emit Deposited(count, msg.sender);
    }

    /**
     * @notice Release funds to the beneficiary.
     * @param sig Signature of the beneficiary.
     * @param info Struct containing beneficiary details.
     */
    function releaseFund(bytes memory sig, Beneficiary memory info) external {
        if (info.receiver == address(0)) {
            revert InvalidZeroAddress();
        }

        if (block.timestamp > info.deadline) {
            revert SignatureExpired();
        }

        address beneficiary = _verifySignature(info, sig);
        if (beneficiary == address(0)) {
            revert InvalidZeroAddress();
        }

        _releaseFunds(info.id, info.receiver, beneficiary);
    }

    /**
     * @notice Verifies the signature of the beneficiary.
     * @param info Struct containing beneficiary details.
     * @param _sig Signature of the beneficiary.
     * @return beneficiary Address of the beneficiary.
     */
    function _verifySignature(
        Beneficiary memory info,
        bytes memory _sig
    ) internal view returns (address beneficiary) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    keccak256(
                        "Beneficiary(uint256 id,uint256 amount,address receiver,uint256 deadline)"
                    ),
                    info.id,
                    info.amount,
                    info.receiver,
                    info.deadline
                )
            )
        );

        beneficiary = ECDSA.recover(digest, _sig);
        bytes32 beneficiaryHash = keccak256(abi.encodePacked(beneficiary));
        if (beneficiaryHash != idToBeneficiaryMap[info.id].beneficiaryHash) {
            revert SignatureInvalid();
        }
    }

    /**
     * @notice Releases the funds to the specified receiver.
     * @param id Unique identifier for the beneficiary.
     * @param receiver Address receiving the funds.
     * @param beneficiary Address of the beneficiary.
     */
    function _releaseFunds(
        uint256 id,
        address receiver,
        address beneficiary
    ) internal {
        if (idToBeneficiaryMap[id].isReleased) {
            revert FundsAlreadyReleased();
        }

        uint256 amount = idToBeneficiaryMap[id].amount;

        if (idToBeneficiaryMap[id].isToken == false) {
            _transferETH(receiver, amount);
        } else {
            idToBeneficiaryMap[id].token.transfer(receiver, amount);
        }

        idToBeneficiary[id] = beneficiary;
        idToBeneficiaryMap[id].amount = 0;
        idToBeneficiaryMap[id].isReleased = true;

        emit FundReleased(
            id,
            beneficiary,
            receiver,
            address(idToBeneficiaryMap[id].token),
            amount
        );
    }

    /**
     * @notice Transfers ETH to the specified receiver.
     * @param receiver Address receiving the ETH.
     * @param amount Amount of ETH to transfer.
     */
    function _transferETH(address receiver, uint256 amount) internal {
        (bool ok, ) = receiver.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
    }

    /**
     * @notice Withdraws all ETH from the contract.
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;

        if (balance > 0) {
            address owner = owner();
            _transferETH(owner, balance);
            emit WithdrawETH(owner, balance);
        }
    }

    /**
     * @notice Withdraws all tokens of a specified type from the contract.
     * @param _token Address of the ERC20 token contract.
     */
    function withdrawTokens(IERC20Token _token) external onlyOwner {
        uint256 balance = _token.balanceOf(address(this));

        if (balance > 0) {
            address owner = owner();
            _token.transfer(owner, balance);
            emit WithdrawToken(owner, balance);
        }
    }
}
