pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CheckIn_Z is ZamaEthereumConfig {
    
    struct CheckInData {
        string locationId;                    
        euint32 encryptedTimestamp;        
        uint256 publicLatitude;          
        uint256 publicLongitude;          
        string description;            
        address user;               
        uint256 creationTime;             
        uint32 decryptedTimestamp; 
        bool isVerified; 
    }
    

    mapping(string => CheckInData) public checkInData;
    
    string[] public locationIds;
    
    event CheckInCreated(string indexed locationId, address indexed user);
    event DecryptionVerified(string indexed locationId, uint32 decryptedTimestamp);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createCheckIn(
        string calldata locationId,
        externalEuint32 encryptedTimestamp,
        bytes calldata inputProof,
        uint256 publicLatitude,
        uint256 publicLongitude,
        string calldata description
    ) external {
        require(bytes(checkInData[locationId].locationId).length == 0, "Check-in data already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedTimestamp, inputProof)), "Invalid encrypted input");
        
        checkInData[locationId] = CheckInData({
            locationId: locationId,
            encryptedTimestamp: FHE.fromExternal(encryptedTimestamp, inputProof),
            publicLatitude: publicLatitude,
            publicLongitude: publicLongitude,
            description: description,
            user: msg.sender,
            creationTime: block.timestamp,
            decryptedTimestamp: 0,
            isVerified: false
        });
        
        FHE.allowThis(checkInData[locationId].encryptedTimestamp);
        
        FHE.makePubliclyDecryptable(checkInData[locationId].encryptedTimestamp);
        
        locationIds.push(locationId);
        
        emit CheckInCreated(locationId, msg.sender);
    }
    
    function verifyDecryption(
        string calldata locationId, 
        bytes memory abiEncodedClearTimestamp,
        bytes memory decryptionProof
    ) external {
        require(bytes(checkInData[locationId].locationId).length > 0, "Check-in data does not exist");
        require(!checkInData[locationId].isVerified, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(checkInData[locationId].encryptedTimestamp);
        
        FHE.checkSignatures(cts, abiEncodedClearTimestamp, decryptionProof);
        
        uint32 decodedTimestamp = abi.decode(abiEncodedClearTimestamp, (uint32));
        
        checkInData[locationId].decryptedTimestamp = decodedTimestamp;
        checkInData[locationId].isVerified = true;
        
        emit DecryptionVerified(locationId, decodedTimestamp);
    }
    
    function getEncryptedTimestamp(string calldata locationId) external view returns (euint32) {
        require(bytes(checkInData[locationId].locationId).length > 0, "Check-in data does not exist");
        return checkInData[locationId].encryptedTimestamp;
    }
    
    function getCheckInData(string calldata locationId) external view returns (
        string memory locationIdValue,
        uint256 publicLatitude,
        uint256 publicLongitude,
        string memory description,
        address user,
        uint256 creationTime,
        bool isVerified,
        uint32 decryptedTimestamp
    ) {
        require(bytes(checkInData[locationId].locationId).length > 0, "Check-in data does not exist");
        CheckInData storage data = checkInData[locationId];
        
        return (
            data.locationId,
            data.publicLatitude,
            data.publicLongitude,
            data.description,
            data.user,
            data.creationTime,
            data.isVerified,
            data.decryptedTimestamp
        );
    }
    
    function getAllLocationIds() external view returns (string[] memory) {
        return locationIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


