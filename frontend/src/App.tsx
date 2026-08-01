import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import NavBar from './components/NavBar'
import ProtectedRoute from './components/ProtectedRoute'
import ShareList from './pages/ShareList'
import ShareDetail from './pages/ShareDetail'
import ShareReport from './pages/ShareReport'
import ShareEdit from './pages/ShareEdit'

import EpubList from './pages/EpubList'
import EpubEditor from './pages/EpubEditor'
import GuideList from './pages/GuideList'
import GuideTemplates from './pages/GuideTemplates'
import NewsList from './pages/NewsList'
import NewsDetail from './pages/NewsDetail'
import LegalList from './pages/LegalList'
import LegalDetail from './pages/LegalDetail'
import LegalWrite from './pages/LegalWrite'
import LegalSchedule from './pages/LegalSchedule'
import PsychoList from './pages/PsychoList'
import PsychoDetail from './pages/PsychoDetail'
import PsychoWrite from './pages/PsychoWrite'
import PsychoSchedule from './pages/PsychoSchedule'
import VillagePage from './pages/VillagePage'
import VillageEventList from './pages/VillageEventList'
import VillageEventDetail from './pages/VillageEventDetail'
import VillageMyWishes from './pages/VillageMyWishes'
import FriendsList from './pages/FriendsList'
import FriendsMap from './pages/FriendsMap'
import MessageInbox from './pages/MessageInbox'
import MessageSend from './pages/MessageSend'
import ConstructionPage from './pages/ConstructionPage'
import SchedulePage from './pages/SchedulePage'
import AdminDashboard from './pages/AdminDashboard'
import AdminUsers from './pages/AdminUsers'
import AdminNews from './pages/AdminNews'
import AdminShareReports from './pages/AdminShareReports'
import AdminStores from './pages/AdminStores'
import AdminAlerts from './pages/AdminAlerts'
import AdminAiChat from './pages/AdminAiChat'
import AdminAiTrain from './pages/AdminAiTrain'
import AdminAiBroadcasts from './pages/AdminAiBroadcasts'
import AdminPendingLetters from './pages/AdminPendingLetters'
import AdminPageManagers from './pages/AdminPageManagers'
import AdminMessage from './pages/AdminMessage'
import AdminPostgresql from './pages/AdminPostgresql'
import AdminRampApplications from './pages/AdminRampApplications'
import AdminPostDetail from './pages/AdminPostDetail'
import IntroPage from './pages/IntroPage'
import PresentationPage from './pages/PresentationPage'
import ProposalPage from './pages/ProposalPage'
import AllProposalsPage from './pages/AllProposalsPage'
import TermsPage from './pages/TermsPage'
import CharterPage from './pages/CharterPage'
import MainPage from './pages/MainPage'
import GoPage from './pages/GoPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ResetConfirmPage from './pages/ResetConfirmPage'
import ServiceLegalPage from './pages/ServiceLegalPage'
import ServiceLegalEditPage from './pages/ServiceLegalEditPage'
import ServicePsychoPage from './pages/ServicePsychoPage'
import ServicePsychoEditPage from './pages/ServicePsychoEditPage'
import ServiceRampPage from './pages/ServiceRampPage'
import StoreDetailPage from './pages/StoreDetailPage'
import AiChatPage from './pages/AiChatPage'
import ChatPage from './pages/ChatPage'
import TongBotChatPage from './pages/TongBotChatPage'
import ViewPage from './pages/ViewPage'
import SearchPage from './pages/SearchPage'
import LegalIssuesPage from './pages/LegalIssuesPage'
import LegalIssueWritePage from './pages/LegalIssueWritePage'
import LegalIssueDetailPage from './pages/LegalIssueDetailPage'
import LegalIssuesAdminPage from './pages/LegalIssuesAdminPage'
import LeaderShareReportsPage from './pages/LeaderShareReportsPage'
import ShareMapPage from './pages/ShareMapPage'


import PsychoAdminPage from './pages/PsychoAdminPage'
import PsychoAdminAppointmentsPage from './pages/PsychoAdminAppointmentsPage'
import UserProfilePage from './pages/UserProfilePage'
import IntroProfilePage from './pages/IntroProfilePage'
import EditProfilePage from './pages/EditProfilePage'
import SchedulePopupPage from './pages/SchedulePopupPage'
import MemoPage from './pages/MemoPage'
import VillageAdminPage from './pages/VillageAdminPage'
import VillageQrPage from './pages/VillageQrPage'
import VillageQrDisplay from './pages/VillageQrDisplay'
import VillageQrApprovals from './pages/VillageQrApprovals'
import VillageEventCreatePage from './pages/VillageEventCreatePage'
import VillageEventQrPage from './pages/VillageEventQrPage'
import VillageJinConsentPage from './pages/VillageJinConsentPage'
import VillageJoinPage from './pages/VillageJoinPage'
import NewsTabsPage from './pages/NewsTabsPage'
import MyDID from './pages/MyDID'
import AdminIssueVC from './pages/AdminIssueVC'
import DIDClaimPage from './pages/DIDClaimPage'
import AdminNewsEdit from './pages/AdminNewsEdit'
import AdminNewsRecommendations from './pages/AdminNewsRecommendations'
import AdminStoreEdit from './pages/AdminStoreEdit'
import AdminAlertEdit from './pages/AdminAlertEdit'
import VillagePageEdit from './pages/VillagePageEdit'
import VillagePageView from './pages/VillagePageView'
import CompassNavPage from './pages/CompassNavPage'
import PsychoPostEdit from './pages/PsychoPostEdit'
import FloatingMemo from './components/FloatingMemo'
import PopupBar from './components/PopupBar'

function Footer() {
  const host = window.location.hostname
  const name = host === 'localhost' || host === '127.0.0.1' ? '함께사는로컬'
    : host === 'test.unocum.kr' ? '함께사는테스트' : '함께사는양평'
  return (
    <footer className="text-center py-4 border-top" style={{ background: '#f8f9fa' }}>
      <span className="fw-bold text-success">{name}</span>
      <span className="text-muted mx-2">|</span>
      <a href="mailto:admin@unocum.kr" className="text-muted text-decoration-none small">admin@unocum.kr</a>
    </footer>
  )
}

function usePopup() {
  const [params] = useState(() => new URLSearchParams(window.location.search))
  return params.get('popup') === '1'
}

export default function App() {
  const isPopup = usePopup()
  return (
    <AuthProvider>
      <BrowserRouter>
        {isPopup && <PopupBar />}
        {!isPopup && <NavBar />}
        {!isPopup && <FloatingMemo />}
        <div className={isPopup ? '' : 'container pb-5'}>
          <Routes>
            {/* Public: intro / auth / share (공유마당) */}
            <Route path="/" element={<IntroPage />} />
            <Route path="/intro" element={<IntroPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/reset-password/:token" element={<ResetConfirmPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/charter" element={<CharterPage />} />
            <Route path="/share" element={<ShareList />} />
            <Route path="/share/detail/:id" element={<ShareDetail />} />
            <Route path="/share/report" element={<ShareReport />} />
            <Route path="/share/edit/:id" element={<ShareEdit />} />
            <Route path="/share/map" element={<ShareMapPage />} />
            <Route path="/leader/share-reports" element={<LeaderShareReportsPage />} />
            <Route path="/compass" element={<CompassNavPage />} />

            {/* Protected: all other routes require login */}
            <Route path="/presentation" element={<ProtectedRoute><PresentationPage /></ProtectedRoute>} />
            <Route path="/proposal" element={<ProtectedRoute><ProposalPage /></ProtectedRoute>} />
            <Route path="/all-proposals" element={<ProtectedRoute><AllProposalsPage /></ProtectedRoute>} />
            <Route path="/main" element={<ProtectedRoute><MainPage /></ProtectedRoute>} />
            <Route path="/go" element={<ProtectedRoute><GoPage /></ProtectedRoute>} />
            <Route path="/service/legal" element={<ProtectedRoute><ServiceLegalPage /></ProtectedRoute>} />
            <Route path="/service/legal/edit" element={<ProtectedRoute><ServiceLegalEditPage /></ProtectedRoute>} />
            <Route path="/service/psycho" element={<ProtectedRoute><ServicePsychoPage /></ProtectedRoute>} />
            <Route path="/service/psycho/edit" element={<ProtectedRoute><ServicePsychoEditPage /></ProtectedRoute>} />
            <Route path="/service/ramp" element={<ProtectedRoute><ServiceRampPage /></ProtectedRoute>} />
            <Route path="/ai/chat" element={<ProtectedRoute><AiChatPage /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
            <Route path="/bot/chat" element={<ProtectedRoute><TongBotChatPage /></ProtectedRoute>} />
            <Route path="/post/:postId" element={<ProtectedRoute><ViewPage /></ProtectedRoute>} />
            <Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />
            <Route path="/epub" element={<ProtectedRoute><EpubList /></ProtectedRoute>} />
            <Route path="/epub/list" element={<ProtectedRoute><EpubList /></ProtectedRoute>} />
            <Route path="/epub/new" element={<ProtectedRoute><EpubList /></ProtectedRoute>} />
            <Route path="/epub/edit/:id" element={<ProtectedRoute><EpubEditor /></ProtectedRoute>} />
            <Route path="/guide" element={<ProtectedRoute><GuideList /></ProtectedRoute>} />
            <Route path="/guide/templates" element={<ProtectedRoute><GuideTemplates /></ProtectedRoute>} />
            <Route path="/user/edit-profile" element={<ProtectedRoute><EditProfilePage /></ProtectedRoute>} />
            <Route path="/user/:userId" element={<ProtectedRoute><UserProfilePage /></ProtectedRoute>} />
            <Route path="/intro-profile" element={<ProtectedRoute><IntroProfilePage /></ProtectedRoute>} />
            <Route path="/news" element={<ProtectedRoute><NewsList /></ProtectedRoute>} />
            <Route path="/news/:id" element={<ProtectedRoute><NewsDetail /></ProtectedRoute>} />
            <Route path="/world-news" element={<ProtectedRoute><NewsTabsPage /></ProtectedRoute>} />
            <Route path="/yp-news" element={<ProtectedRoute><NewsTabsPage /></ProtectedRoute>} />
            <Route path="/kr-yp-news" element={<ProtectedRoute><NewsTabsPage /></ProtectedRoute>} />
            <Route path="/legal/issues/admin" element={<ProtectedRoute><LegalIssuesAdminPage /></ProtectedRoute>} />
            <Route path="/legal/issues/write" element={<ProtectedRoute><LegalIssueWritePage /></ProtectedRoute>} />
            <Route path="/legal/issues/:postId" element={<ProtectedRoute><LegalIssueDetailPage /></ProtectedRoute>} />
            <Route path="/legal/issues" element={<ProtectedRoute><LegalIssuesPage /></ProtectedRoute>} />
            <Route path="/legal" element={<ProtectedRoute><LegalList /></ProtectedRoute>} />
            <Route path="/legal/:id" element={<ProtectedRoute><LegalDetail /></ProtectedRoute>} />
            <Route path="/legal/write" element={<ProtectedRoute><LegalWrite /></ProtectedRoute>} />
            <Route path="/legal/schedule" element={<ProtectedRoute><LegalSchedule /></ProtectedRoute>} />
            <Route path="/psycho/admin/appointments" element={<ProtectedRoute><PsychoAdminAppointmentsPage /></ProtectedRoute>} />
            <Route path="/psycho/admin" element={<ProtectedRoute><PsychoAdminPage /></ProtectedRoute>} />
            <Route path="/psycho" element={<ProtectedRoute><PsychoList /></ProtectedRoute>} />
            <Route path="/psycho/:id" element={<ProtectedRoute><PsychoDetail /></ProtectedRoute>} />
            <Route path="/psycho/:id/edit" element={<ProtectedRoute><PsychoPostEdit /></ProtectedRoute>} />
            <Route path="/psycho/write" element={<ProtectedRoute><PsychoWrite /></ProtectedRoute>} />
            <Route path="/psycho/schedule" element={<ProtectedRoute><PsychoSchedule /></ProtectedRoute>} />
            <Route path="/village/admin" element={<ProtectedRoute><VillageAdminPage /></ProtectedRoute>} />
            <Route path="/village/qr" element={<ProtectedRoute><VillageQrPage /></ProtectedRoute>} />
            <Route path="/village/qr-display" element={<ProtectedRoute><VillageQrDisplay /></ProtectedRoute>} />
            <Route path="/village/qr-approvals" element={<ProtectedRoute><VillageQrApprovals /></ProtectedRoute>} />
            <Route path="/village/event/create" element={<ProtectedRoute><VillageEventCreatePage /></ProtectedRoute>} />
            <Route path="/village/event/:eventId/qr" element={<ProtectedRoute><VillageEventQrPage /></ProtectedRoute>} />
            <Route path="/village/invite/:target" element={<ProtectedRoute><VillageJinConsentPage /></ProtectedRoute>} />
            <Route path="/village/join" element={<ProtectedRoute><VillageJoinPage /></ProtectedRoute>} />
            <Route path="/village" element={<ProtectedRoute><VillagePage /></ProtectedRoute>} />
            <Route path="/village/page" element={<ProtectedRoute><VillagePageEdit /></ProtectedRoute>} />
            <Route path="/village/view/:tmyeon/:tri" element={<ProtectedRoute><VillagePageView /></ProtectedRoute>} />
            <Route path="/village/events" element={<ProtectedRoute><VillageEventList /></ProtectedRoute>} />
            <Route path="/village/events/:id" element={<ProtectedRoute><VillageEventDetail /></ProtectedRoute>} />
            <Route path="/village/my-wishes" element={<ProtectedRoute><VillageMyWishes /></ProtectedRoute>} />
            <Route path="/friends" element={<ProtectedRoute><FriendsList /></ProtectedRoute>} />
            <Route path="/friends/map" element={<ProtectedRoute><FriendsMap /></ProtectedRoute>} />
            <Route path="/messages" element={<ProtectedRoute><MessageInbox /></ProtectedRoute>} />
            <Route path="/message/inbox" element={<ProtectedRoute><MessageInbox /></ProtectedRoute>} />
            <Route path="/message/send" element={<ProtectedRoute><MessageSend /></ProtectedRoute>} />
            <Route path="/message/send/global" element={<ProtectedRoute><MessageSend /></ProtectedRoute>} />
            <Route path="/message/send/admin" element={<ProtectedRoute><MessageSend /></ProtectedRoute>} />
            <Route path="/message/send/village_leader" element={<ProtectedRoute><MessageSend /></ProtectedRoute>} />
            <Route path="/message/admin/pending" element={<ProtectedRoute><AdminPendingLetters /></ProtectedRoute>} />
            <Route path="/construction" element={<ProtectedRoute><ConstructionPage /></ProtectedRoute>} />
            <Route path="/construction/store/:storeName" element={<ProtectedRoute><StoreDetailPage /></ProtectedRoute>} />
            <Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
            <Route path="/memo" element={<ProtectedRoute><MemoPage /></ProtectedRoute>} />
            <Route path="/schedule2" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
            <Route path="/schedule-popup" element={<ProtectedRoute><SchedulePopupPage /></ProtectedRoute>} />
            <Route path="/my/did" element={<ProtectedRoute><MyDID /></ProtectedRoute>} />
            <Route path="/did/claim" element={<ProtectedRoute><DIDClaimPage /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/news" element={<ProtectedRoute><AdminNews /></ProtectedRoute>} />
            <Route path="/admin/news/create" element={<ProtectedRoute><AdminNewsEdit /></ProtectedRoute>} />
            <Route path="/admin/news/edit/:id" element={<ProtectedRoute><AdminNewsEdit /></ProtectedRoute>} />
            <Route path="/admin/labor-news/edit/:id" element={<ProtectedRoute><AdminNewsEdit type="labor" /></ProtectedRoute>} />
            <Route path="/admin/labor-news/create" element={<ProtectedRoute><AdminNewsEdit type="labor" /></ProtectedRoute>} />
            <Route path="/admin/news/recommendations" element={<ProtectedRoute><AdminNewsRecommendations /></ProtectedRoute>} />
            <Route path="/admin/share-reports" element={<ProtectedRoute><AdminShareReports /></ProtectedRoute>} />
            <Route path="/admin/stores" element={<ProtectedRoute><AdminStores /></ProtectedRoute>} />
            <Route path="/admin/stores/new" element={<ProtectedRoute><AdminStoreEdit /></ProtectedRoute>} />
            <Route path="/admin/stores/edit/:id" element={<ProtectedRoute><AdminStoreEdit /></ProtectedRoute>} />
            <Route path="/admin/alerts" element={<ProtectedRoute><AdminAlerts /></ProtectedRoute>} />
            <Route path="/admin/alerts/new" element={<ProtectedRoute><AdminAlertEdit /></ProtectedRoute>} />
            <Route path="/admin/alerts/edit/:id" element={<ProtectedRoute><AdminAlertEdit /></ProtectedRoute>} />
            <Route path="/admin/ai-chat" element={<ProtectedRoute><AdminAiChat /></ProtectedRoute>} />
            <Route path="/admin/ai-train" element={<ProtectedRoute><AdminAiTrain /></ProtectedRoute>} />
            <Route path="/admin/ai-broadcasts" element={<ProtectedRoute><AdminAiBroadcasts /></ProtectedRoute>} />
            <Route path="/admin/pending-letters" element={<ProtectedRoute><AdminPendingLetters /></ProtectedRoute>} />
            <Route path="/admin/page-managers" element={<ProtectedRoute><AdminPageManagers /></ProtectedRoute>} />
            <Route path="/admin/message" element={<ProtectedRoute><AdminMessage /></ProtectedRoute>} />
            <Route path="/admin/postgresql" element={<ProtectedRoute><AdminPostgresql /></ProtectedRoute>} />
            <Route path="/admin/ramp-applications" element={<ProtectedRoute><AdminRampApplications /></ProtectedRoute>} />
            <Route path="/admin/post/:id" element={<ProtectedRoute><AdminPostDetail /></ProtectedRoute>} />
            <Route path="/admin/did/issue" element={<ProtectedRoute><AdminIssueVC /></ProtectedRoute>} />

            {/* Default */}
            <Route path="*" element={<IntroPage />} />
          </Routes>
        </div>
        {!isPopup && <Footer />}
      </BrowserRouter>
    </AuthProvider>
  )
}
