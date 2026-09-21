import { Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import ModuleList from './pages/ModuleList'
import Training from './pages/Training'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/modules" element={<ModuleList />} />
      <Route path="/training" element={<Training />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
