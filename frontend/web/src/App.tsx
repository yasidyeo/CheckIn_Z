import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface CheckInData {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [checkIns, setCheckIns] = useState<CheckInData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCheckIn, setCreatingCheckIn] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newCheckInData, setNewCheckInData] = useState({ name: "", latitude: "", longitude: "" });
  const [selectedCheckIn, setSelectedCheckIn] = useState<CheckInData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [userHistory, setUserHistory] = useState<CheckInData[]>([]);
  const [stats, setStats] = useState({ total: 0, verified: 0, userTotal: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      
      try {
        console.log('Initializing FHEVM for privacy check-in...');
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHE加密系统初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
      } catch (error) {
        console.error('Failed to load check-in data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const checkInsList: CheckInData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          checkInsList.push({
            id: businessId,
            name: businessData.name,
            latitude: Number(businessData.publicValue1) / 1000000,
            longitude: Number(businessData.publicValue2) / 1000000,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1),
            publicValue2: Number(businessData.publicValue2),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue)
          });
        } catch (e) {
          console.error('Error loading check-in data:', e);
        }
      }
      
      setCheckIns(checkInsList);
      updateStats(checkInsList);
      if (address) {
        setUserHistory(checkInsList.filter(checkIn => checkIn.creator.toLowerCase() === address.toLowerCase()));
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载签到数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: CheckInData[]) => {
    setStats({
      total: data.length,
      verified: data.filter(item => item.isVerified).length,
      userTotal: address ? data.filter(item => item.creator.toLowerCase() === address.toLowerCase()).length : 0
    });
  };

  const createCheckIn = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingCheckIn(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE创建隐私签到..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const latitudeValue = Math.round(parseFloat(newCheckInData.latitude) * 1000000);
      const businessId = `checkin-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, latitudeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newCheckInData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        latitudeValue,
        Math.round(parseFloat(newCheckInData.longitude) * 1000000),
        "隐私位置签到"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "隐私签到创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewCheckInData({ name: "", latitude: "", longitude: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingCheckIn(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE系统可用性检查成功!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "可用性检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredCheckIns = checkIns.filter(checkIn => {
    const matchesSearch = checkIn.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || checkIn.isVerified;
    return matchesSearch && matchesFilter;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">📍</div>
            <h1>隐私签到 FHE</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="intro-section">
          <div className="intro-card">
            <h2>🔐 隐私位置签到系统</h2>
            <p>使用Zama FHE全同态加密技术，保护您的位置隐私</p>
            <div className="feature-grid">
              <div className="feature-item">
                <div className="feature-icon">🛡️</div>
                <h3>位置加密</h3>
                <p>坐标数据在链上加密存储，保护隐私</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🔍</div>
                <h3>零知识验证</h3>
                <p>证明到过某地而不暴露具体位置</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🌐</div>
                <h3>无轨迹泄露</h3>
                <p>签到记录不会形成可追踪的移动轨迹</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">正在准备隐私保护环境</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载隐私签到数据...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">📍</div>
          <h1>隐私签到 FHE</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            测试系统
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 新建签到
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="stats-section">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-info">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">总签到数</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-info">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">已验证</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">👤</div>
          <div className="stat-info">
            <div className="stat-value">{stats.userTotal}</div>
            <div className="stat-label">我的签到</div>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="controls-section">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="搜索签到地点..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filters">
            <label className="filter-toggle">
              <input 
                type="checkbox" 
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              仅显示已验证
            </label>
            <button onClick={loadData} className="refresh-btn">
              {isRefreshing ? "刷新中..." : "刷新数据"}
            </button>
          </div>
        </div>

        <div className="content-grid">
          <div className="checkins-section">
            <h2>隐私签到记录</h2>
            <div className="checkins-list">
              {filteredCheckIns.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📍</div>
                  <p>暂无签到记录</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    创建第一个签到
                  </button>
                </div>
              ) : (
                filteredCheckIns.map((checkIn, index) => (
                  <div 
                    className={`checkin-item ${checkIn.isVerified ? 'verified' : ''}`}
                    key={index}
                    onClick={() => setSelectedCheckIn(checkIn)}
                  >
                    <div className="checkin-header">
                      <h3>{checkIn.name}</h3>
                      <span className={`status-badge ${checkIn.isVerified ? 'verified' : 'pending'}`}>
                        {checkIn.isVerified ? '✅ 已验证' : '🔒 待验证'}
                      </span>
                    </div>
                    <div className="checkin-meta">
                      <span>坐标: ●●●.●●●●●, ●●●.●●●●●</span>
                      <span>时间: {new Date(checkIn.timestamp * 1000).toLocaleString()}</span>
                    </div>
                    <div className="checkin-creator">
                      创建者: {checkIn.creator.substring(0, 8)}...{checkIn.creator.substring(36)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sidebar">
            <div className="user-history">
              <h3>我的签到历史</h3>
              {userHistory.length === 0 ? (
                <p className="no-history">暂无历史记录</p>
              ) : (
                <div className="history-list">
                  {userHistory.slice(0, 5).map((item, index) => (
                    <div key={index} className="history-item">
                      <div className="history-name">{item.name}</div>
                      <div className="history-time">{new Date(item.timestamp * 1000).toLocaleDateString()}</div>
                      <div className={`history-status ${item.isVerified ? 'verified' : 'pending'}`}>
                        {item.isVerified ? '✅' : '🔒'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="fhe-info">
              <h3>FHE技术说明</h3>
              <div className="info-item">
                <strong>位置加密</strong>
                <p>经纬度坐标使用FHE加密后存储</p>
              </div>
              <div className="info-item">
                <strong>零知识验证</strong>
                <p>证明到过某地而不暴露具体位置</p>
              </div>
              <div className="info-item">
                <strong>隐私保护</strong>
                <p>不会形成可追踪的移动轨迹</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreateCheckIn 
          onSubmit={createCheckIn} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingCheckIn} 
          checkInData={newCheckInData} 
          setCheckInData={setNewCheckInData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedCheckIn && (
        <CheckInDetailModal 
          checkIn={selectedCheckIn} 
          onClose={() => setSelectedCheckIn(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedCheckIn.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateCheckIn: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  checkInData: any;
  setCheckInData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, checkInData, setCheckInData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCheckInData({ ...checkInData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-checkin-modal">
        <div className="modal-header">
          <h2>新建隐私签到</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE位置加密 🔐</strong>
            <p>经纬度坐标将使用Zama FHE进行加密保护</p>
          </div>
          
          <div className="form-group">
            <label>地点名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={checkInData.name} 
              onChange={handleChange} 
              placeholder="输入地点名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>纬度 *</label>
            <input 
              type="number" 
              name="latitude" 
              value={checkInData.latitude} 
              onChange={handleChange} 
              placeholder="例如: 39.9042" 
              step="any"
            />
            <div className="data-type-label">FHE加密数据</div>
          </div>
          
          <div className="form-group">
            <label>经度 *</label>
            <input 
              type="number" 
              name="longitude" 
              value={checkInData.longitude} 
              onChange={handleChange} 
              placeholder="例如: 116.4074" 
              step="any"
            />
            <div className="data-type-label">公开数据</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !checkInData.name || !checkInData.latitude || !checkInData.longitude} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建隐私签到"}
          </button>
        </div>
      </div>
    </div>
  );
};

const CheckInDetailModal: React.FC<{
  checkIn: CheckInData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ checkIn, onClose, isDecrypting, decryptData }) => {
  const [decryptedLatitude, setDecryptedLatitude] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (checkIn.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedLatitude(decrypted / 1000000);
    }
  };

  const displayLatitude = checkIn.isVerified ? 
    (checkIn.decryptedValue ? checkIn.decryptedValue / 1000000 : null) : 
    decryptedLatitude;

  return (
    <div className="modal-overlay">
      <div className="checkin-detail-modal">
        <div className="modal-header">
          <h2>签到详情</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="checkin-info">
            <div className="info-row">
              <span>地点名称:</span>
              <strong>{checkIn.name}</strong>
            </div>
            <div className="info-row">
              <span>创建者:</span>
              <strong>{checkIn.creator.substring(0, 8)}...{checkIn.creator.substring(36)}</strong>
            </div>
            <div className="info-row">
              <span>签到时间:</span>
              <strong>{new Date(checkIn.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>位置数据</h3>
            
            <div className="data-row">
              <div className="data-label">纬度:</div>
              <div className="data-value">
                {displayLatitude !== null ? 
                  `${displayLatitude.toFixed(6)} ${checkIn.isVerified ? '(链上验证)' : '(本地解密)'}` : 
                  "🔒 FHE加密数据"
                }
              </div>
            </div>
            
            <div className="data-row">
              <div className="data-label">经度:</div>
              <div className="data-value">
                {(checkIn.longitude / 1000000).toFixed(6)} (公开数据)
              </div>
            </div>
            
            <div className="fhe-actions">
              <button 
                className={`decrypt-btn ${checkIn.isVerified ? 'verified' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || checkIn.isVerified}
              >
                {isDecrypting ? "验证中..." : 
                 checkIn.isVerified ? "✅ 已验证" : 
                 "🔓 验证解密"}
              </button>
            </div>
          </div>
          
          <div className="privacy-note">
            <div className="privacy-icon">🛡️</div>
            <div>
              <strong>隐私保护说明</strong>
              <p>您的真实位置坐标已被加密存储，只有通过零知识证明验证才能解密查看</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
        </div>
      </div>
    </div>
  );
};

export default App;


