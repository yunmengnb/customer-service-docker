<!-- 忆梦云团队开发 -->
<template>
  <!-- 加载中 -->
  <div v-if="loading" class="loading-page">加载中...</div>

  <!-- 链接无效 -->
  <div v-else-if="!channel" class="invalid-link">
    <h2>客服链接无效</h2>
    <p>请使用正确的客服链接访问</p>
  </div>

  <!-- 聊天页 -->
  <div
    v-else
    class="chat-page"
    :style="{ position: 'fixed', insetInline: 0, height: viewportHeight, top: viewportTop }"
  >
    <div class="chat-header">
      <img v-if="channel.avatarUrl" class="chat-avatar" :src="channel.avatarUrl" alt="渠道头像" />
      <div v-else class="chat-avatar">{{ channel.brandName?.[0] || '客' }}</div>
      <div class="chat-header-info">
        <div class="chat-header-name">
          <span>{{ channel.brandName || '在线客服' }}</span>
          <span class="agent-presence" :class="agentOnline ? 'is-online' : 'is-offline'">
            <span class="agent-presence-dot"></span>
            {{ agentOnline ? '在线' : '离线' }}
          </span>
        </div>
        <div class="chat-header-status">
          <span v-if="conversationStatus === 'active'">客服已接入</span>
          <span v-else-if="conversationStatus === 'closed'">会话已结束，再次发送消息可重新咨询</span>
          <span v-else>等待客服接入...</span>
        </div>
      </div>
      <button v-if="customer" type="button" class="complaint-trigger" @click="openComplaint">投诉</button>
      <button v-if="customer" type="button" class="profile-trigger" @click="openDashboard">
        控制面板
      </button>
    </div>

    <div class="chat-messages" ref="msgContainer" @scroll="handleMessageScroll">
      <div v-if="loadingHistory" class="history-loading">正在加载历史消息...</div>
      <div v-else-if="!hasMoreMessages && messages.length" class="history-end">没有更早的消息了</div>
      <div
        v-for="msg in messages"
        :key="msg._id || msg.clientMessageId"
        :class="['msg', msg.recalledAt ? 'system' : msg.senderType]"
      >
        <template v-if="msg.recalledAt">
          <div class="msg-bubble">
            {{ msg.senderType === 'customer' ? '客户撤回一条消息' : '客服撤回一条消息' }}
          </div>
        </template>
        <template v-else-if="msg.senderType === 'system'">
          <div class="msg-bubble">{{ msg.content }}</div>
        </template>
        <template v-else>
          <img
            v-if="msg.senderType === 'customer' && customerAvatarVisible()"
            class="msg-avatar"
            v-cached-avatar="customer.avatarUrl"
            :src="avatarSrc(customer.avatarUrl)"
            alt="我的头像"
            @error="handleAvatarError(customer.avatarUrl)"
          />
          <img
            v-else-if="msg.senderType !== 'customer' && (msg.sender?.avatarUrl || channel.avatarUrl)"
            class="msg-avatar"
            :src="msg.sender?.avatarUrl || channel.avatarUrl"
            alt="客服头像"
          />
          <div v-else class="msg-avatar msg-avatar-fallback">
            {{ msg.senderType === 'customer' ? (customer?.qq?.slice(-1) || '我') : (msg.senderType === 'bot' ? 'AI' : (channel.brandName?.[0] || '客')) }}
          </div>
          <div class="msg-content">
            <div class="msg-main">
              <span v-if="msg.sendFailed" class="message-send-error" title="消息发送失败">!</span>
            <div
              class="msg-bubble"
              :class="{ 'bare-media': ['image', 'video'].includes(msg.messageType), 'media-message-bubble': ['image', 'video', 'file'].includes(msg.messageType) && (msg.attachmentId || msg.attachmentUrl || msg.localObjectUrl || msg.uploadPhase), 'message-menu-active': contextMenu?.msg === msg }"
              @contextmenu="showContextMenu($event, msg)"
              @touchstart="startLongPress($event, msg)"
              @touchend="finishLongPress"
              @touchcancel="cancelLongPress"
              @touchmove="moveLongPress"
              @click.capture="handleBubbleClick"
            >
              <span v-if="msg.recalledAt" class="message-recalled">消息已撤回</span>
              <template v-else-if="attachmentExpired(msg)"><span class="chat-media-expired">该文件已过期并自动清理</span><div v-if="['image', 'video'].includes(msg.messageType) && imageCaption(msg)" class="message-caption">{{ imageCaption(msg) }}</div></template>
              <template v-else-if="msg.messageType === 'image'">
                    <button type="button" class="chat-media" :disabled="Boolean(msg.uploadPhase)" :aria-label="msg.uploadPhase ? '附件尚未发送' : '查看原图'" @click="openPreview(msg)">
                      <span class="chat-media-placeholder">图片加载中</span>
                      <img :src="mediaSrc(msg)" v-lazy-media="{ msg }" class="chat-media-image" alt="" loading="lazy" decoding="async" @load="handleChatMediaLoad" @error="handleChatMediaError" />

                      <span v-if="msg.uploadPhase === 'uploading'" class="chat-media-progress" aria-hidden="true"><i :style="{ width: msg.uploadProgress + '%' }"></i></span>
                    </button>
                    <div v-if="imageCaption(msg)" class="message-caption">{{ imageCaption(msg) }}</div>
                  </template>
              <template v-else-if="msg.messageType === 'video'">
                    <button type="button" class="chat-media message-video-wrap" :disabled="Boolean(msg.uploadPhase)" :aria-label="msg.uploadPhase ? '附件尚未发送' : '播放视频'" @click="openPreview(msg)">
                      <span class="chat-media-placeholder">暂无视频封面</span>
                      <img :src="mediaSrc(msg, true)" v-lazy-media="{ msg, thumbnail: true }" class="chat-media-image" alt="" loading="lazy" decoding="async" @load="handleChatMediaLoad" @error="handleChatMediaError" />
                      <span class="chat-media-play"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9 5v14l11-7z" fill="currentColor" /></svg></span>
                      <span v-if="msg.uploadPhase === 'uploading'" class="chat-media-progress" aria-hidden="true"><i :style="{ width: msg.uploadProgress + '%' }"></i></span>
                    </button>
                    <div v-if="imageCaption(msg)" class="message-caption">{{ imageCaption(msg) }}</div>
                  </template>
              <button v-else-if="msg.messageType === 'file' && (msg.attachmentId || msg.attachmentUrl || msg.uploadPhase)" type="button" class="message-file" :disabled="Boolean(msg.uploadPhase)" @click="downloadFile(msg)">
                <span class="message-file-icon">▤</span>
                <span>{{ msg.attachmentName || '文件' }}<small v-if="!msg.uploadPhase">{{ isDownloaded(msg) ? (getNativeAttachmentBridge() ? '已保存' : '分享/选择应用') : '下载' }}</small></span>
              </button>
              <template v-else>
                <template v-for="(part, index) in parseMessageContent(msg.content)" :key="index">
                  <a
                    v-if="part.type === 'link'"
                    class="message-link"
                    :href="part.href"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click.stop
                  >{{ part.text }}</a>
                  <span v-else>{{ part.text }}</span>
                </template>
              </template>
            </div>
            </div>
            <div v-if="msg.uploadPhase || msg.sendFailed" class="message-transfer-status" :class="{ failed: msg.uploadPhase === 'failed' || msg.sendFailed }" :tabindex="msg.uploadPhase === 'failed' || msg.sendFailed ? 0 : undefined" role="status">
              <template v-if="msg.uploadPhase === 'uploading'">正在上传 {{ msg.uploadProgress }}%</template>
              <template v-else-if="msg.uploadPhase === 'sending'">上传完成，正在发送消息</template>
              <template v-else>上传或发送失败</template>
            </div>
            <div v-if="msg.autoReplyType === 'keyword'" class="keyword-reply-notice">关键词自动回复内容可作为参考</div>
            <div class="msg-time">{{ formatTime(msg.createdAt) }}</div>
          </div>
        </template>
      </div>
    </div>

    <div class="chat-composer">
      <Transition name="attachment-panel">
        <div v-if="showAttachments" class="attachment-panel">
          <button type="button" class="attachment-action" :disabled="uploading" @click="imageInput?.click()">
            <span class="attachment-icon attachment-image-icon">▧</span>
            <span>上传图片</span>
          </button>
          <button type="button" class="attachment-action" :disabled="uploading" @click="videoInput?.click()">
            <span class="attachment-icon attachment-video-icon">▷</span>
            <span>上传视频</span>
          </button>
          <button type="button" class="attachment-action" :disabled="uploading" @click="fileInput?.click()">
            <span class="attachment-icon attachment-file-icon">▤</span>
            <span>上传文件</span>
          </button>
        </div>
      </Transition>

      <div class="chat-input-area">
        <button
          type="button"
          class="attachment-toggle"
          :class="{ active: showAttachments }"
          :disabled="!customer || uploading"
          aria-label="打开附件菜单"
          @click="showAttachments = !showAttachments"
        >+</button>
        <textarea
          v-model="inputText"
          :disabled="!customer || uploading"
          :placeholder="uploading ? '正在上传...' : '请输入消息...'"
          @focus="handleComposerFocus"
          @keydown.enter.exact="handleMessageEnter"
          rows="1"
        ></textarea>
        <button class="send-button" @click="sendMessage" :disabled="!customer || !inputText.trim() || sending || uploading">
          发送
        </button>
      </div>

      <input ref="imageInput" class="hidden-file-input" type="file" accept="image/*" @change="handleAttachment($event, 'image')" />
      <input ref="videoInput" class="hidden-file-input" type="file" accept="video/*" @change="handleAttachment($event, 'video')" />
      <input ref="fileInput" class="hidden-file-input" type="file" @change="handleAttachment($event, 'file')" />
    </div>

    <div v-if="preview" class="media-preview" @click.self="closePreview" @dblclick="closePreview">
      <div class="media-preview-actions">
        <button type="button" @click.stop="downloadFile(preview.msg || preview.url, preview.name || (preview.type === 'video' ? '视频' : '图片'))">保存</button>
        <button type="button" class="media-preview-close" aria-label="关闭预览" @click.stop="closePreview">×</button>
      </div>
      <div v-if="preview.loading" role="status" style="color:white">正在安全加载…</div>
      <button v-else-if="preview.error" type="button" @click="openPreview(preview.msg)">{{ preview.errorMessage || '加载失败，点击重试' }}</button>
      <img v-else-if="preview.type === 'image'" :src="preview.url" :alt="preview.name || '图片预览'" />
      <video v-else-if="preview.url" ref="previewVideo" :key="preview.url" :src="preview.url" controls autoplay preload="metadata" playsinline @loadedmetadata="previewMediaEvent" @canplay="previewMediaEvent" @playing="previewMediaEvent" @waiting="previewMediaEvent" @error="previewMediaEvent"></video>
      <div v-if="preview.type === 'video' && preview.buffering && !preview.error && !preview.loading" role="status" style="position:absolute;bottom:80px;left:10%;right:10%;text-align:center;color:white;pointer-events:none">正在加载/缓冲视频…</div>
    </div>

    <div v-if="contextMenu" class="message-menu-mask" @pointerdown="contextMenu = null">
      <div class="message-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @pointerdown.stop>
        <button v-if="contextMenu.msg.messageType !== 'image'" type="button" @click="copyMessage(contextMenu.msg)">复制</button>
        <button v-if="canRecallMessage(contextMenu.msg)" type="button" @click="recallMessage(contextMenu.msg)">撤回</button>
        <button v-if="canDeleteMessage(contextMenu.msg)" type="button" class="danger" @click="deleteMessage(contextMenu.msg)">删除</button>
      </div>
    </div>

    <div v-if="downloadProgress" class="download-progress" :class="{ failed: downloadProgress.status === 'failed', indeterminate: downloadProgress.status === 'downloading' && !downloadProgress.computable }">
      <div v-if="downloadProgress.status === 'failed'">下载失败</div>
      <div v-else-if="downloadProgress.status === 'success'">文件已保存</div>
      <div v-else-if="downloadProgress.computable">正在下载 {{ downloadProgress.percent }}% · {{ formatBytes(downloadProgress.loaded) }} / {{ formatBytes(downloadProgress.total) }}</div>
      <div v-else>正在下载 · 已接收 {{ formatBytes(downloadProgress.loaded) }}</div>
      <span><i :style="downloadProgress.computable ? { width: downloadProgress.percent + '%' } : undefined"></i></span>
    </div>
    <div v-else-if="toast" class="bottom-toast">{{ toast }}</div>

    <!-- 客户控制面板 -->
    <div v-if="showDashboard" class="modal-overlay dashboard-overlay" @click.self="closeDashboard">
      <section class="dashboard-panel" role="dialog" aria-modal="true" aria-labelledby="dashboard-title">
        <header class="dashboard-header">
          <div>
            <div class="dashboard-eyebrow">客户中心</div>
            <h2 id="dashboard-title">控制面板</h2>
          </div>
          <button type="button" class="dashboard-close" aria-label="关闭控制面板" @click="closeDashboard">×</button>
        </header>

        <div class="dashboard-content dashboard-shortcut">
          <div class="dashboard-info-grid">
            <div><span>会话ID</span><strong>{{ conversation?._id || '-' }}</strong></div>
            <div><span>接入时间</span><strong>{{ formatDateTime(conversation?.acceptedAt) }}</strong></div>
            <div><span>当前身份</span><strong>{{ isGuest ? '访客' : '客户账号' }}</strong></div>
            <div><span>当前登录账号</span><strong>{{ isGuest ? '未绑定账号' : (customer?.phone || customer?.email || '-') }}</strong></div>
            <div>
              <span>当前窗口链接</span>
              <button type="button" class="dashboard-copy-link" @click="copyCurrentWindowLink">
                {{ currentWindowLink }}
                <small>点击复制</small>
              </button>
            </div>
          </div>
          <button type="button" class="dashboard-primary" @click="goToAccount">{{ isGuest ? '绑定客户账号' : '进入客户后台' }}</button>
        </div>
      </section>
    </div>

    <!-- 投诉表单 -->
    <div v-if="showComplaint" class="modal-overlay complaint-overlay" @click.self="closeComplaint">
      <section class="complaint-panel" role="dialog" aria-modal="true" aria-labelledby="complaint-title">
        <header class="complaint-header">
          <div>
            <div class="dashboard-eyebrow">意见反馈</div>
            <h2 id="complaint-title">提交投诉</h2>
            <p>请如实描述问题，我们会尽快核查处理。</p>
          </div>
          <button type="button" class="dashboard-close" aria-label="关闭投诉表单" @click="closeComplaint">×</button>
        </header>

        <form class="complaint-form" @submit.prevent="submitComplaint">
          <div class="complaint-form-grid">
            <div class="form-item">
              <label for="complaint-category">投诉类型</label>
              <select id="complaint-category" v-model="complaintForm.category">
                <option value="agent" :disabled="!assignedAgentId">投诉客服</option>
                <option value="platform">平台问题反馈</option>
              </select>
            </div>
            <div class="form-item">
              <label>当前渠道</label>
              <input :value="channel.brandName || channel.name || '-'" disabled />
            </div>
          </div>
          <div class="form-item">
            <label for="complaint-subject">投诉标题</label>
            <input id="complaint-subject" v-model.trim="complaintForm.subject" maxlength="100" placeholder="请概括您遇到的问题" />
          </div>
          <div class="form-item">
            <label for="complaint-content">投诉内容</label>
            <textarea id="complaint-content" v-model.trim="complaintForm.content" maxlength="5000" rows="5" placeholder="请填写事情经过、发生时间及您的诉求"></textarea>
            <div class="complaint-counter">{{ complaintForm.content.length }}/5000</div>
          </div>
          <div class="form-item">
            <label>相关图片 <span class="optional-label">选填，最多5张</span></label>
            <div class="complaint-images">
              <div v-for="(image, index) in complaintImages" :key="image.url" class="complaint-image-item">
                <img :src="image.url" :alt="image.name || `投诉图片${index + 1}`" />
                <button type="button" aria-label="删除图片" @click="removeComplaintImage(index)">×</button>
              </div>
              <button v-if="complaintImages.length < 5" type="button" class="complaint-image-add" :disabled="complaintUploading" @click="complaintImageInput?.click()">
                <span>+</span>
                {{ complaintUploading ? '上传中' : '添加图片' }}
              </button>
            </div>
            <input ref="complaintImageInput" class="hidden-file-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple @change="uploadComplaintImages" />
          </div>
          <div class="form-item">
            <label for="complaint-email-code">邮箱验证码</label>
            <div class="email-code-row">
              <input id="complaint-email-code" v-model.trim="complaintForm.emailCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="请输入6位验证码" />
              <button type="button" :disabled="complaintEmailCodeLoading || complaintEmailCodeCountdown > 0" @click="sendComplaintEmailCode">
                {{ complaintEmailCodeCountdown > 0 ? `${complaintEmailCodeCountdown}秒后重发` : (complaintEmailCodeLoading ? '发送中...' : '发送验证码') }}
              </button>
            </div>
          </div>
          <div v-if="complaintCaptcha.enabled && complaintCaptcha.provider === 'image'" class="form-item">
            <label for="complaint-captcha">提交验证</label>
            <div class="captcha-row">
              <input id="complaint-captcha" v-model.trim="complaintCaptchaCode" autocomplete="off" maxlength="8" placeholder="请输入验证码" />
              <button type="button" class="captcha-image-button" :disabled="complaintCaptchaLoading" @click="loadComplaintCaptcha">
                <img v-if="complaintCaptcha.image" :src="complaintCaptcha.image" alt="图形验证码" />
                <span v-else>{{ complaintCaptchaLoading ? '加载中...' : '点击刷新' }}</span>
              </button>
            </div>
          </div>
          <div v-else-if="complaintCaptcha.enabled && complaintCaptcha.provider === 'geetest'" class="captcha-tip">
            {{ complaintGeetestReady ? '提交投诉时完成极验安全验证' : (complaintCaptchaLoading ? '正在加载安全验证...' : '安全验证加载失败，请重试') }}
          </div>
          <div v-if="complaintMessage" :class="['password-feedback', complaintSuccess ? 'success' : 'error']">{{ complaintMessage }}</div>
          <div class="complaint-actions">
            <button type="button" class="btn btn-ghost" @click="closeComplaint">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="complaintSubmitting || complaintUploading">
              {{ complaintSubmitting ? '提交中...' : '提交投诉' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <!-- 登录注册弹窗 -->
    <div v-if="showLogin" class="modal-overlay auth-overlay">
      <div class="modal-content auth-modal">
        <div class="modal-title">{{ channel.brandName || '在线客服' }}</div>
        <div v-if="authStep === 'identity'" class="identity-choice">
          <div class="modal-desc">请选择本次咨询身份</div>
          <button type="button" class="identity-option" @click="enterAsGuest">
            <strong>访客咨询</strong><span>无需注册，可通过当前设备指纹恢复会话</span>
          </button>
          <button type="button" class="identity-option primary" @click="chooseCustomerIdentity">
            <strong>客户账号</strong><span>登录或注册后可进入客户后台并跨渠道使用</span>
          </button>
        </div>
        <template v-else>
        <div v-if="isGuest" class="guest-bind-notice">当前为访客身份，登录或注册会将本次聊天记录绑定到客户账号。</div>
        <div class="auth-tabs">
          <button type="button" :class="{ active: authTab === 'register' }" @click="switchAuthTab('register')">注册</button>
          <button type="button" :class="{ active: authTab === 'login' }" @click="switchAuthTab('login')">登录</button>
          <button type="button" :class="{ active: authTab === 'forgot' }" @click="switchAuthTab('forgot')">找回密码</button>
        </div>
        <template v-if="authTab === 'register'">
          <div class="modal-desc">注册账号后即可开始咨询</div>
          <div class="auth-form-grid">
            <div class="form-item"><label>手机号</label><input v-model.trim="registerForm.phone" inputmode="tel" placeholder="请输入手机号" /></div>
            <div class="form-item"><label>QQ号</label><input v-model.trim="registerForm.qq" inputmode="numeric" maxlength="12" placeholder="请输入5-12位QQ号" /></div>
          </div>
          <div class="form-item"><label>邮箱</label><input v-model.trim="registerForm.email" type="email" autocomplete="email" placeholder="请输入邮箱" /></div>
          <div class="form-item">
            <label>邮箱验证码</label>
            <div class="email-code-row">
              <input v-model.trim="registerForm.emailCode" inputmode="numeric" maxlength="6" placeholder="请输入6位验证码" />
              <button type="button" :disabled="codeLoading || codeCountdown > 0" @click="sendRegisterCode">{{ codeCountdown > 0 ? `${codeCountdown}秒后重发` : (codeLoading ? '发送中...' : '发送验证码') }}</button>
            </div>
          </div>
          <div class="auth-form-grid">
            <div class="form-item"><label>密码</label><input v-model="registerForm.password" type="password" autocomplete="new-password" placeholder="请输入6-72位密码" /></div>
            <div class="form-item"><label>确认密码</label><input v-model="registerForm.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入密码" @keyup.enter="doRegister" /></div>
          </div>
          <label class="agreement-check">
            <input v-model="agreed" type="checkbox" />
            <span>我已阅读并同意<router-link to="/agreements/disclaimer" target="_blank">《免责协议》</router-link>和<router-link to="/agreements/terms" target="_blank">《使用协议》</router-link></span>
          </label>
        </template>
        <template v-else-if="authTab === 'login'">
          <div class="modal-desc">使用手机号或邮箱登录</div>
          <div class="form-item"><label>手机号或邮箱</label><input v-model.trim="loginForm.identifier" autocomplete="username" placeholder="请输入手机号或邮箱" /></div>
          <div class="form-item"><label>密码</label><input v-model="loginForm.password" type="password" autocomplete="current-password" placeholder="请输入密码" @keyup.enter="doLogin" /></div>
        </template>
        <template v-else>
          <div class="modal-desc">验证注册手机号和邮箱后重置密码</div>
          <div class="form-item"><label>手机号</label><input v-model.trim="resetForm.phone" inputmode="tel" autocomplete="tel" placeholder="请输入注册手机号" /></div>
          <div class="form-item"><label>邮箱</label><input v-model.trim="resetForm.email" type="email" autocomplete="email" placeholder="请输入注册邮箱" /></div>
          <div class="form-item"><label>邮箱验证码</label><div class="email-code-row"><input v-model.trim="resetForm.emailCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="请输入6位验证码" /><button type="button" :disabled="resetCodeLoading || resetCodeCountdown > 0" @click="sendResetCode">{{ resetCodeCountdown ? `${resetCodeCountdown}秒后重发` : (resetCodeLoading ? '发送中...' : '发送验证码') }}</button></div></div>
          <div class="auth-form-grid">
            <div class="form-item"><label>新密码</label><input v-model="resetForm.newPassword" type="password" autocomplete="new-password" placeholder="请输入6-72位新密码" /></div>
            <div class="form-item"><label>确认新密码</label><input v-model="resetForm.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码" @keyup.enter="submitResetPassword" /></div>
          </div>
        </template>
        <div v-if="authTab !== 'forgot' && captcha.enabled && captcha.provider === 'image'" class="form-item">
          <label>图形验证码</label>
          <div class="captcha-row">
            <input v-model.trim="captchaCode" autocomplete="off" maxlength="8" placeholder="请输入验证码" :aria-label="'图形验证码'" />
            <button type="button" class="captcha-image-button" :disabled="captchaLoading" @click="loadCaptcha">
              <img v-if="captcha.image" :src="captcha.image" alt="图形验证码" />
              <span v-else>{{ captchaLoading ? '加载中...' : '点击刷新' }}</span>
            </button>
          </div>
        </div>
        <div v-else-if="authTab !== 'forgot' && captcha.enabled && captcha.provider === 'geetest'" class="captcha-tip">
          {{ geetestReady ? '提交后完成安全验证' : (captchaLoading ? '正在加载安全验证...' : '安全验证加载失败，请重试') }}
        </div>
        <div class="err" v-if="loginErr">{{ loginErr }}</div>
        <div class="modal-actions">
          <button v-if="!isGuest" type="button" class="btn btn-ghost" @click="authStep = 'identity'">返回选择</button>
          <button class="btn btn-primary" @click="submitAuth" :disabled="loginLoading || (authTab !== 'forgot' && captchaLoading)">
            {{ loginLoading ? '处理中...' : (authTab === 'register' ? '注册并进入聊天' : (authTab === 'login' ? '登录并进入聊天' : '重置密码')) }}
          </button>
        </div>
        </template>
      </div>
    </div>

    <!-- 访客禁止进入 APP -->
    <div v-if="showGuestAppBlocked" class="modal-overlay" @click.self="showGuestAppBlocked = false">
      <div class="modal-content install-guide-modal" role="dialog" aria-modal="true" aria-labelledby="guest-app-title">
        <div class="install-guide-icon">访</div>
        <div id="guest-app-title" class="modal-title">{{ guestPromptReason === 'return' ? '注册或绑定客户账号' : '访客无法进入客户后台' }}</div>
        <div class="modal-desc">{{ guestPromptReason === 'return' ? '绑定客户账号后，本次访客聊天记录和客服渠道会归入该账号；也可以暂不绑定并继续咨询。' : '客户后台仅对已注册客户开放。绑定账号后，本次访客聊天记录会保留并归入该账号。' }}</div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" @click="showGuestAppBlocked = false">继续访客咨询</button>
          <button type="button" class="btn btn-primary" @click="openGuestBinding">绑定客户账号</button>
        </div>
      </div>
    </div>

    <!-- 客户端下载引导 -->
    <div v-if="showInstallGuide" class="modal-overlay install-guide-overlay" @click.self="dismissInstallGuide">
      <div class="modal-content install-guide-modal" role="dialog" aria-modal="true" aria-labelledby="install-guide-title">
        <div class="install-guide-icon">客</div>
        <div id="install-guide-title" class="modal-title">{{ isIOS ? '添加客户后台到主屏幕' : '下载安卓客户端' }}</div>
        <div v-if="isIOS" class="modal-desc">请点击浏览器底部的“分享”按钮，然后选择“添加到主屏幕”，即可快速进入客户后台。</div>
        <div v-else class="modal-desc">安装安卓客户端后，可快速进入客户后台并查看历史客服渠道。</div>
        <div v-if="appDownloadError" class="err">{{ appDownloadError }}</div>
        <div class="modal-actions install-guide-actions">
          <button type="button" class="btn btn-ghost" @click="dismissInstallGuide">{{ isIOS ? '我知道了' : '暂不下载' }}</button>
          <button type="button" class="btn btn-ghost" @click="dismissInstallGuideToday">今天内不提醒</button>
          <button v-if="!isIOS" type="button" class="btn btn-primary" :disabled="appDownloadLoading" @click="downloadAndroidApp">{{ appDownloadLoading ? '获取中...' : '下载客户端' }}</button>
        </div>
      </div>
    </div>

    <!-- QQ 弹窗 -->
    <div v-if="showQQModal" class="modal-overlay">
      <div class="modal-content">
        <div class="modal-title">{{ customer?.qq ? '修改QQ号' : '完善信息' }}</div>
        <div class="modal-desc">填写QQ号后，将自动更新QQ头像</div>
        <div class="form-item">
          <label>QQ号</label>
          <input v-model.trim="qqForm.qq" inputmode="numeric" maxlength="12" placeholder="请输入5-12位QQ号" @keyup.enter="submitQQ" />
        </div>
        <div class="err" v-if="qqErr">{{ qqErr }}</div>
        <div class="modal-actions">
          <button v-if="customer?.qq" class="btn btn-ghost" @click="showQQModal = false">取消</button>
          <button class="btn btn-primary" @click="submitQQ" :disabled="qqLoading">
            {{ qqLoading ? '提交中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, getSocket } from '../api'
import {
  acquireObjectUrl,
  avatarCacheKey,
  cacheMessages,
  cleanupChatCache,
  clearIdentityCache,
  clientCacheScope,
  clientIdentityScope,
  getCachedMessages,
  initializeChatCache,
  invalidateAttachment,
  isPrivateAvatarUrl,
  loadCachedAvatar,
  loadCachedMedia,
  mediaCacheKey,
  releaseObjectUrl,
  subscribePrivateMedia,
} from '../chatCache'
import {
  canShareBlob,
  clearAttachmentDownloaded,
  createClientMessageId,
  deleteNativeAttachment,
  downloadProgressState,
  formatBytes,
  getNativeAttachmentBridge,
  getNativeAttachmentState,
  markAttachmentDownloaded,
  openNativeAttachment,
  saveBlob,
  saveNativeAttachment,
  wasAttachmentDownloaded,
} from '../attachmentActions'

const route = useRoute()
const router = useRouter()
const token = computed(() => route.params.token)
const mountedToken = String(route.params.token || '')
const PUBLIC_CHANNEL_CACHE_VERSION = 1
const PUBLIC_CHANNEL_CACHE_FRESHNESS = 30000
const publicChannelCacheKey = `client_public_channel_${mountedToken}`
let sessionActive = true
const deletedMessageIds = new Set()
function isCurrentSession() { return sessionActive && String(token.value || '') === mountedToken }
function belongsToConversation(data) {
  return Boolean(isCurrentSession() && conversation.value?._id && data?.conversationId &&
    String(data.conversationId) === String(conversation.value._id) &&
    (!data.tenantId || String(data.tenantId) === String(customer.value?.tenantId)) &&
    (!data.channelToken || String(data.channelToken) === mountedToken) &&
    (!data.publicToken || String(data.publicToken) === mountedToken))
}
const currentWindowLink = computed(() => {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/c/${token.value}`
})

const loading = ref(true)
const channel = ref(null)
const customer = ref(null)
const conversation = ref(null)
const conversationStatus = ref('waiting')
const assignedAgentId = ref('')
const agentOnline = ref(false)
const messages = ref([])
const cacheScope = computed(() => clientCacheScope(customer.value, channel.value?.id || channel.value?._id || customer.value?.channelId || token.value))
const conversationCacheId = computed(() => conversation.value?._id || conversation.value?.id || customer.value?.conversationId || token.value)
const persistMessages = () => cacheMessages(
  cacheScope.value,
  conversationCacheId.value,
  messages.value.filter(message => !message.uploadPhase && !message.localObjectUrl),
)
const inputText = ref('')
const sending = ref(false)
const uploading = ref(false)
const showAttachments = ref(false)
const imageInput = ref(null)
const videoInput = ref(null)
const fileInput = ref(null)
const msgContainer = ref(null)
const loadingHistory = ref(false)
const hasMoreMessages = ref(true)
const positionMode = ref('latest')
const pendingMessages = ref(0)
const preview = ref(null)
const previewVideo = ref(null)
const mediaUrls = ref({})
const mediaRequests = new Map()
const mediaSubscriptions = new Map()
const avatarUrls = ref({})
const failedAvatarUrls = ref({})
const avatarRequests = new Map()
const contextMenu = ref(null)
const downloadProgress = ref(null)
const downloadedVersion = ref(0)
const toast = ref('')
const viewportHeight = ref('100dvh')
const viewportTop = ref('0px')

const showLogin = ref(false)
const authStep = ref('identity')
const isGuest = computed(() => customer.value?.identityType === 'guest')
const showGuestAppBlocked = ref(false)
const guestPromptReason = ref('account')
const showInstallGuide = ref(false)
const userAgent = navigator.userAgent || ''
const isIOS = /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
const isCustomerAndroidApp = /YiMengCustomerAndroid\/[\w.-]+/i.test(userAgent)
const appDownloadLoading = ref(false)
const appDownloadError = ref('')
const authTab = ref('register')
const loginForm = ref({ identifier: '', password: '' })
const registerForm = ref({ phone: '', qq: '', email: '', emailCode: '', password: '', confirmPassword: '' })
const agreed = ref(false)
const resetForm = ref({ phone: '', email: '', emailCode: '', newPassword: '', confirmPassword: '' })
const loginLoading = ref(false)
const loginErr = ref('')
const codeLoading = ref(false)
const codeCountdown = ref(0)
const resetCodeLoading = ref(false)
const resetCodeCountdown = ref(0)
const captcha = ref({ enabled: false, provider: '', captchaId: '', image: '' })
const captchaCode = ref('')
const captchaLoading = ref(false)
const geetestReady = ref(false)

const showQQModal = ref(false)
const qqForm = ref({ qq: '' })
const qqLoading = ref(false)
const qqErr = ref('')

const showDashboard = ref(false)

const showComplaint = ref(false)
const complaintForm = ref({ category: 'agent', subject: '', content: '', emailCode: '' })
const complaintImages = ref([])
const complaintImageInput = ref(null)
const complaintUploading = ref(false)
const complaintCaptcha = ref({ enabled: false, provider: '', captchaId: '', image: '' })
const complaintCaptchaCode = ref('')
const complaintCaptchaLoading = ref(false)
const complaintGeetestReady = ref(false)
const complaintSubmitting = ref(false)
const complaintEmailCodeLoading = ref(false)
const complaintEmailCodeCountdown = ref(0)
const complaintMessage = ref('')
const complaintSuccess = ref(false)

let socket = null
let notificationAudioContext = null
let messageSyncTimer = null
let channelStatusTimer = null
let presenceQueryVersion = 0
let messageSyncInFlight = false
let toastTimer = null
let longPressTimer = null
let longPressStart = null
let suppressBubbleClickUntil = 0
let scrollFrame = null
let positionObserver = null
let positionMutation = null
let positionAnchor = null
let positionIntentUntil = 0
let positionTouchY = 0
let sessionGeneration = 0
let messageRequestAbort = null
let serverSnapshotCursor = null
let codeCountdownTimer = null
let resetCodeTimer = null
let complaintEmailCodeTimer = null
let geetestInstance = null
let complaintGeetestInstance = null
let geetestScriptPromise = null
let installGuideDismissed = false
const installGuideDismissedDateKey = `client_install_guide_dismissed_${isIOS ? 'ios' : 'android'}_date`

function localDateKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function requestInstallGuide() {
  if (isGuest.value) return
  if (!installGuideDismissed && !isCustomerAndroidApp && localStorage.getItem(installGuideDismissedDateKey) !== localDateKey()) {
    appDownloadError.value = ''
    showInstallGuide.value = true
  }
}

function dismissInstallGuide() {
  installGuideDismissed = true
  showInstallGuide.value = false
}

function dismissInstallGuideToday() {
  localStorage.setItem(installGuideDismissedDateKey, localDateKey())
  dismissInstallGuide()
}

async function downloadAndroidApp() {
  appDownloadLoading.value = true
  appDownloadError.value = ''
  try {
    const res = await api.get('/app/customer-center/android/version')
    const downloadUrl = res.code === 0 ? res.data?.downloadUrl : ''
    if (!downloadUrl) throw new Error('暂无可下载的安卓客户端')
    window.location.assign(downloadUrl)
    showInstallGuide.value = false
  } catch (error) {
    appDownloadError.value = error?.message || '安卓客户端下载配置获取失败，请稍后重试。'
  } finally {
    appDownloadLoading.value = false
  }
}

function loadGeetestScript() {
  if (window.initGeetest) return Promise.resolve()
  if (geetestScriptPromise) return geetestScriptPromise
  geetestScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://static.geetest.com/static/tools/gt.js'
    script.async = true
    script.onload = () => window.initGeetest ? resolve() : reject(new Error('极验组件初始化失败'))
    script.onerror = () => reject(new Error('极验组件加载失败'))
    document.head.appendChild(script)
  }).catch(error => {
    geetestScriptPromise = null
    throw error
  })
  return geetestScriptPromise
}

async function initializeGeetest(captchaConfig) {
  const gt = captchaConfig.gt
  const challenge = captchaConfig.challenge
  if (!gt || !challenge) throw new Error('极验 V3 初始化参数不完整')

  geetestReady.value = false
  geetestInstance?.destroy?.()
  geetestInstance = null
  await loadGeetestScript()
  await new Promise((resolve, reject) => {
    window.initGeetest({
      gt,
      challenge,
      offline: captchaConfig.success === false || captchaConfig.success === 0,
      new_captcha: captchaConfig.new_captcha ?? captchaConfig.newCaptcha ?? true,
      product: 'bind',
      width: '100%',
    }, instance => {
      geetestInstance = instance
      instance.onReady(() => {
        geetestReady.value = true
        resolve()
      })
      instance.onError(error => reject(new Error(error?.msg || '极验组件初始化失败')))
    })
  })
}

async function loadCaptcha() {
  captchaLoading.value = true
  captchaCode.value = ''
  geetestReady.value = false
  try {
    const res = await api.get(`/client/channels/${token.value}/captcha`)
    if (res.code !== 0) throw new Error(res.message || '验证码加载失败')
    captcha.value = { enabled: false, provider: '', captchaId: '', image: '', ...res.data }
    if (captcha.value.enabled && captcha.value.provider === 'geetest') {
      await initializeGeetest(captcha.value)
    }
  } catch (error) {
    captcha.value = { enabled: true, provider: '', captchaId: '', image: '' }
    loginErr.value = error?.message || '验证码加载失败，请刷新重试'
  } finally {
    captchaLoading.value = false
  }
}

function getGeetestValidation() {
  return new Promise((resolve, reject) => {
    if (!geetestInstance || !geetestReady.value) {
      reject(new Error('安全验证尚未加载完成'))
      return
    }
    geetestInstance.onSuccess(() => {
      const result = geetestInstance.getValidate()
      if (result) resolve(result)
      else reject(new Error('请完成安全验证'))
    })
    geetestInstance.onError(error => reject(new Error(error?.msg || '安全验证失败')))
    geetestInstance.onClose(() => reject(new Error('请完成安全验证')))
    geetestInstance.verify()
  })
}

function getNotificationAudioContext() {
  if (!notificationAudioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (AudioContext) notificationAudioContext = new AudioContext()
  }
  return notificationAudioContext
}

async function unlockNotificationSound() {
  const context = getNotificationAudioContext()
  if (context?.state === 'suspended') await context.resume().catch(() => {})
}

function playNotificationSound() {
  const context = getNotificationAudioContext()
  if (!context || context.state !== 'running') return
  const start = context.currentTime
  ;[
    { delay: 0, frequency: 1320 },
    { delay: 0.14, frequency: 1760 },
    { delay: 0.3, frequency: 1480 },
  ].forEach(({ delay, frequency }) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(frequency, start + delay)
    gain.gain.setValueAtTime(0.0001, start + delay)
    gain.gain.exponentialRampToValueAtTime(0.7, start + delay + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.13)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start + delay)
    oscillator.stop(start + delay + 0.14)
  })
}

function applyAgentOnline(realOnline) {
  agentOnline.value = channel.value?.status === 'online' && Boolean(realOnline)
}

function publicChannelData(data) {
  if (!data || typeof data !== 'object') return null
  const allowed = ['id', 'name', 'brandName', 'brandColor', 'avatarUrl', 'welcomeMessage', 'offlineMessage', 'status', 'agentIds', 'agentOnline']
  return Object.fromEntries(allowed.filter(key => data[key] !== undefined).map(key => [key, data[key]]))
}

function readPublicChannelCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(publicChannelCacheKey) || 'null')
    if (cached?.version !== PUBLIC_CHANNEL_CACHE_VERSION || cached?.token !== mountedToken ||
        !Number.isFinite(cached?.timestamp) || Date.now() - cached.timestamp < 0 ||
        Date.now() - cached.timestamp > PUBLIC_CHANNEL_CACHE_FRESHNESS) return null
    return publicChannelData(cached.data)
  } catch {
    return null
  }
}

function writePublicChannelCache(data) {
  const publicData = publicChannelData(data)
  if (!publicData || String(token.value || '') !== mountedToken) return
  try {
    localStorage.setItem(publicChannelCacheKey, JSON.stringify({
      token: mountedToken,
      version: PUBLIC_CHANNEL_CACHE_VERSION,
      timestamp: Date.now(),
      data: publicData,
    }))
  } catch {}
}

async function refreshChannelStatus() {
  if (document.visibilityState === 'hidden') return
  try {
    const res = await api.get(`/client/channels/${token.value}`)
    if (!isCurrentSession() || res.code !== 0 || !res.data) return
    writePublicChannelCache(res.data)
    const previousStatus = channel.value?.status
    channel.value = { ...channel.value, ...res.data }
    if (previousStatus !== res.data.status || !socket?.connected) {
      applyAgentOnline(res.data.agentOnline)
    } else {
      queryAgentPresence()
    }
  } catch {}
}

async function loadChannel() {
  try {
    const cachedChannel = readPublicChannelCache()
    if (cachedChannel) {
      channel.value = cachedChannel
      document.title = cachedChannel.brandName || '在线客服'
      applyAgentOnline(cachedChannel.agentOnline)
      loading.value = false
    }
    const saved = localStorage.getItem('client_token')
    const [channelResult, meResult] = await Promise.allSettled([
      api.get(`/client/channels/${token.value}`),
      saved ? api.get('/client/me') : Promise.resolve(null),
    ])

    if (!isCurrentSession()) return
    const channelRes = channelResult.status === 'fulfilled' ? channelResult.value : null
    if (!channelRes) {
      if (!cachedChannel) channel.value = null
      return
    }
    if (channelRes.code !== 0 || !channelRes.data) {
      channel.value = null
      return
    }
    channel.value = channelRes.data
    writePublicChannelCache(channelRes.data)
    localStorage.setItem('client_channel_token', token.value)
    document.title = channelRes.data.brandName || '在线客服'
    if (!assignedAgentId.value) applyAgentOnline(channelRes.data.agentOnline)

    let meRes = meResult.status === 'fulfilled' ? meResult.value : null
    if (meRes?.code === 0 && String(meRes.data.channelId) !== String(channelRes.data.id)) {
      try {
        const switchRes = await api.post(`/client/channels/${token.value}/switch`)
        if (!isCurrentSession()) return
        if (switchRes.code === 0) {
          localStorage.setItem('client_token', switchRes.data.token)
          meRes = await api.get('/client/me')
        } else {
          meRes = null
        }
      } catch {
        meRes = null
      }
    }
    if (!isCurrentSession()) return
    if (meRes?.code === 0) {
      customer.value = meRes.data
      setupSocket()
      await loadConversation()
      await loadMessages()
      if (isGuest.value) {
        guestPromptReason.value = 'return'
        showGuestAppBlocked.value = true
      } else if (!customer.value.qq) {
        showQQModal.value = true
      }
    } else {
      showLogin.value = true
      authStep.value = 'identity'
    }
  } finally {
    loading.value = false
    if (!showLogin.value) requestInstallGuide()
  }
}

async function loadMe() {
  try {
    const res = await api.get('/client/me')
    if (!isCurrentSession()) return
    if (res.code === 0) {
      customer.value = res.data
      await loadConversation()
      await loadMessages()
      setupSocket()
      if (!customer.value.qq) showQQModal.value = true
    }
  } catch (e) {
    await clearIdentityCache(clientIdentityScope(customer.value))
    localStorage.removeItem('client_token')
  }
}

function switchAuthTab(tab) {
  authTab.value = tab
  loginErr.value = ''
  captchaCode.value = ''
  geetestInstance?.reset?.()
}

function chooseCustomerIdentity() {
  authStep.value = 'account'
  authTab.value = 'login'
  loadCaptcha()
}

async function enterAsGuest() {
  loginErr.value = ''
  loginLoading.value = true
  try {
    const res = await api.post(`/client/channels/${token.value}/auth/guest`, { fingerprint: generateFingerprint() })
    await completeAuth(res)
  } catch (error) {
    loginErr.value = error?.message || '访客进入失败'
  } finally {
    loginLoading.value = false
  }
}

function submitAuth() {
  if (authTab.value === 'register') return doRegister()
  if (authTab.value === 'login') return doLogin()
  return submitResetPassword()
}

async function getCaptchaPayload() {
  if (captcha.value.enabled && captcha.value.provider === 'image') {
    if (!captchaCode.value) throw new Error('请输入图形验证码')
    return { captchaId: captcha.value.captchaId, captchaCode: captchaCode.value }
  }
  if (captcha.value.enabled && captcha.value.provider === 'geetest') return getGeetestValidation()
  if (captcha.value.enabled) throw new Error('安全验证加载失败，请刷新页面重试')
  return {}
}

async function completeAuth(res) {
  if (!isCurrentSession()) return
  if (res.code !== 0) throw new Error(res.message || '认证失败')
  localStorage.setItem('client_token', res.data.token)
  customer.value = res.data.customer
  conversationStatus.value = res.data.conversation.status
  showLogin.value = false
  await loadConversation()
  await loadMessages()
  setupSocket()
  if (res.data.profileRequired) showQQModal.value = true
  requestInstallGuide()
}

async function sendRegisterCode() {
  loginErr.value = ''
  if (!/^\S+@\S+\.\S+$/.test(registerForm.value.email)) {
    loginErr.value = '请输入正确的邮箱地址'
    return
  }
  codeLoading.value = true
  try {
    const res = await api.post(`/client/channels/${token.value}/auth/register-code`, { email: registerForm.value.email })
    if (res.code !== 0) throw new Error(res.message || '验证码发送失败')
    codeCountdown.value = 60
    clearInterval(codeCountdownTimer)
    codeCountdownTimer = setInterval(() => {
      codeCountdown.value -= 1
      if (codeCountdown.value <= 0) clearInterval(codeCountdownTimer)
    }, 1000)
  } catch (error) {
    loginErr.value = error?.message || '验证码发送失败'
  } finally {
    codeLoading.value = false
  }
}

async function sendResetCode() {
  loginErr.value = ''
  const form = resetForm.value
  if (!/^[\d +\-]{6,20}$/.test(form.phone)) return loginErr.value = '请输入正确的手机号'
  if (!/^\S+@\S+\.\S+$/.test(form.email)) return loginErr.value = '请输入正确的邮箱地址'
  resetCodeLoading.value = true
  try {
    const res = await api.post('/client/auth/forgot-password/code', { phone: form.phone, email: form.email })
    if (res.code !== 0) throw new Error(res.message)
    loginErr.value = res.message || '验证码已发送'
    resetCodeCountdown.value = 60
    clearInterval(resetCodeTimer)
    resetCodeTimer = setInterval(() => { if (--resetCodeCountdown.value <= 0) clearInterval(resetCodeTimer) }, 1000)
  } catch (error) { loginErr.value = error?.message || '验证码发送失败' } finally { resetCodeLoading.value = false }
}

async function submitResetPassword() {
  loginErr.value = ''
  const form = resetForm.value
  if (!/^[\d +\-]{6,20}$/.test(form.phone)) return loginErr.value = '请输入正确的手机号'
  if (!/^\S+@\S+\.\S+$/.test(form.email)) return loginErr.value = '请输入正确的邮箱地址'
  if (!/^\d{6}$/.test(form.emailCode)) return loginErr.value = '请输入6位邮箱验证码'
  if (form.newPassword.length < 6 || form.newPassword.length > 72) return loginErr.value = '新密码须为6-72位'
  if (form.newPassword !== form.confirmPassword) return loginErr.value = '两次输入的新密码不一致'
  loginLoading.value = true
  try {
    const res = await api.post('/client/auth/forgot-password/reset', form)
    if (res.code !== 0) throw new Error(res.message)
    switchAuthTab('login')
    loginErr.value = res.message || '密码已重置，请使用新密码登录'
    loginForm.value.identifier = form.phone
    resetForm.value = { phone: '', email: '', emailCode: '', newPassword: '', confirmPassword: '' }
  } catch (error) { loginErr.value = error?.message || '密码重置失败' } finally { loginLoading.value = false }
}

async function doLogin() {
  loginErr.value = ''
  if (!loginForm.value.identifier || !loginForm.value.password) {
    loginErr.value = '请填写完整信息'
    return
  }
  loginLoading.value = true
  try {
    const captchaPayload = await getCaptchaPayload()
    const res = await api.post(`/client/channels/${token.value}/auth/login`, {
      identifier: loginForm.value.identifier,
      password: loginForm.value.password,
      fingerprint: generateFingerprint(),
      ...captchaPayload,
    })
    await completeAuth(res)
  } catch (e) {
    loginErr.value = e?.message || '登录失败'
    if (captcha.value.enabled && captcha.value.provider === 'image') await loadCaptcha()
    geetestInstance?.reset?.()
  } finally {
    loginLoading.value = false
  }
}

async function doRegister() {
  loginErr.value = ''
  const form = registerForm.value
  if (!form.phone || !form.qq || !form.email || !form.emailCode || !form.password || !form.confirmPassword) {
    loginErr.value = '请填写完整注册信息'
    return
  }
  if (!/^[\d +\-]{6,20}$/.test(form.phone)) {
    loginErr.value = '请输入正确的手机号'
    return
  }
  if (!/^[1-9]\d{4,11}$/.test(form.qq)) {
    loginErr.value = '请输入5-12位QQ号'
    return
  }
  if (!/^\S+@\S+\.\S+$/.test(form.email)) {
    loginErr.value = '请输入正确的邮箱地址'
    return
  }
  if (!/^\d{6}$/.test(form.emailCode)) {
    loginErr.value = '请输入6位邮箱验证码'
    return
  }
  if (form.password.length < 6 || form.password.length > 72) {
    loginErr.value = '密码须为6-72位'
    return
  }
  if (form.password !== form.confirmPassword) {
    loginErr.value = '两次输入的密码不一致'
    return
  }
  if (!agreed.value) {
    loginErr.value = '请先阅读并同意免责协议和使用协议'
    return
  }
  loginLoading.value = true
  try {
    const captchaPayload = await getCaptchaPayload()
    const res = await api.post(`/client/channels/${token.value}/auth/register`, {
      ...form,
      agreementAccepted: agreed.value,
      fingerprint: generateFingerprint(),
      ...captchaPayload,
    })
    await completeAuth(res)
  } catch (e) {
    loginErr.value = e?.message || '注册失败'
    if (captcha.value.enabled && captcha.value.provider === 'image') await loadCaptcha()
    geetestInstance?.reset?.()
  } finally {
    loginLoading.value = false
  }
}

function openQQModal() {
  qqForm.value.qq = customer.value?.qq || ''
  qqErr.value = ''
  showQQModal.value = true
}

function openDashboard() {
  showDashboard.value = true
  loadConversation()
}

function closeDashboard() {
  showDashboard.value = false
}

async function initializeComplaintGeetest(captchaConfig) {
  complaintGeetestReady.value = false
  complaintGeetestInstance?.destroy?.()
  complaintGeetestInstance = null
  await loadGeetestScript()
  await new Promise((resolve, reject) => {
    window.initGeetest({
      gt: captchaConfig.gt,
      challenge: captchaConfig.challenge,
      offline: captchaConfig.success === false || captchaConfig.success === 0,
      new_captcha: captchaConfig.new_captcha ?? captchaConfig.newCaptcha ?? true,
      product: 'bind',
      width: '100%',
    }, instance => {
      complaintGeetestInstance = instance
      instance.onReady(() => {
        complaintGeetestReady.value = true
        resolve()
      })
      instance.onError(error => reject(new Error(error?.msg || '极验组件初始化失败')))
    })
  })
}

async function loadComplaintCaptcha() {
  complaintCaptchaLoading.value = true
  complaintCaptchaCode.value = ''
  complaintGeetestReady.value = false
  try {
    const res = await api.get('/client/complaints/captcha')
    if (res.code !== 0) throw new Error(res.message || '验证码加载失败')
    complaintCaptcha.value = { enabled: false, provider: '', captchaId: '', image: '', ...res.data }
    if (complaintCaptcha.value.enabled && complaintCaptcha.value.provider === 'geetest') {
      await initializeComplaintGeetest(complaintCaptcha.value)
    }
  } catch (error) {
    complaintCaptcha.value = { enabled: true, provider: '', captchaId: '', image: '' }
    complaintMessage.value = error?.message || '安全验证加载失败'
  } finally {
    complaintCaptchaLoading.value = false
  }
}

function openComplaint() {
  complaintForm.value = {
    category: assignedAgentId.value ? 'agent' : 'platform',
    subject: '',
    content: '',
    emailCode: '',
  }
  complaintImages.value = []
  complaintMessage.value = ''
  complaintSuccess.value = false
  showComplaint.value = true
  loadComplaintCaptcha()
}

function closeComplaint() {
  if (complaintSubmitting.value || complaintUploading.value) return
  showComplaint.value = false
  complaintMessage.value = ''
  complaintGeetestInstance?.destroy?.()
  complaintGeetestInstance = null
}

async function sendComplaintEmailCode() {
  complaintMessage.value = ''
  complaintSuccess.value = false
  complaintEmailCodeLoading.value = true
  try {
    const res = await api.post('/client/complaints/email-code')
    if (res.code !== 0) throw new Error(res.message || '验证码发送失败')
    complaintEmailCodeCountdown.value = 60
    clearInterval(complaintEmailCodeTimer)
    complaintEmailCodeTimer = setInterval(() => {
      complaintEmailCodeCountdown.value -= 1
      if (complaintEmailCodeCountdown.value <= 0) clearInterval(complaintEmailCodeTimer)
    }, 1000)
    complaintSuccess.value = true
    complaintMessage.value = res.message || '验证码已发送'
  } catch (error) {
    complaintMessage.value = error?.message || '验证码发送失败'
  } finally {
    complaintEmailCodeLoading.value = false
  }
}

function getComplaintCaptchaPayload() {
  if (!complaintCaptcha.value.enabled) return Promise.resolve({})
  if (complaintCaptcha.value.provider === 'image') {
    if (!complaintCaptchaCode.value) return Promise.reject(new Error('请输入图形验证码'))
    return Promise.resolve({ captchaId: complaintCaptcha.value.captchaId, captchaCode: complaintCaptchaCode.value })
  }
  if (complaintCaptcha.value.provider !== 'geetest' || !complaintGeetestInstance || !complaintGeetestReady.value) {
    return Promise.reject(new Error('安全验证尚未加载完成'))
  }
  return new Promise((resolve, reject) => {
    complaintGeetestInstance.onSuccess(() => {
      const result = complaintGeetestInstance.getValidate()
      if (result) resolve(result)
      else reject(new Error('请完成安全验证'))
    })
    complaintGeetestInstance.onError(error => reject(new Error(error?.msg || '安全验证失败')))
    complaintGeetestInstance.onClose(() => reject(new Error('请完成安全验证')))
    complaintGeetestInstance.verify()
  })
}

async function uploadComplaintImages(event) {
  const input = event.target
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length || complaintUploading.value) return
  const available = 5 - complaintImages.value.length
  if (files.length > available) {
    complaintMessage.value = `最多还可添加${available}张图片`
    return
  }
  if (files.some(file => !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type))) {
    complaintMessage.value = '仅支持 JPG、PNG、GIF、WEBP 图片'
    return
  }
  complaintUploading.value = true
  complaintMessage.value = ''
  try {
    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post('/upload/complaint', formData)
      if (res.code !== 0) throw new Error(res.message || '图片上传失败')
      complaintImages.value.push({ url: res.data.url, signature: res.data.signature, name: res.data.name || file.name })
    }
  } catch (error) {
    complaintMessage.value = error?.message || '图片上传失败'
  } finally {
    complaintUploading.value = false
  }
}

function removeComplaintImage(index) {
  complaintImages.value.splice(index, 1)
}

async function submitComplaint() {
  complaintMessage.value = ''
  complaintSuccess.value = false
  const form = complaintForm.value
  if (!form.subject) complaintMessage.value = '请填写投诉标题'
  else if (!form.content) complaintMessage.value = '请填写投诉内容'
  else if (!/^\d{6}$/.test(form.emailCode)) complaintMessage.value = '请输入6位邮箱验证码'
  if (complaintMessage.value) return

  complaintSubmitting.value = true
  try {
    const captchaPayload = await getComplaintCaptchaPayload()
    const res = await api.post('/client/complaints', {
      ...form,
      images: complaintImages.value.map(image => image.url),
      imageSignatures: complaintImages.value.map(image => image.signature),
      ...captchaPayload,
    })
    if (res.code !== 0) throw new Error(res.message || '投诉提交失败')
    complaintSuccess.value = true
    complaintMessage.value = res.message || '投诉提交成功'
    complaintForm.value = { ...form, subject: '', content: '', emailCode: '' }
    complaintImages.value = []
    setTimeout(() => {
      showComplaint.value = false
    }, 1200)
  } catch (error) {
    complaintMessage.value = error?.message || '投诉提交失败'
    if (complaintCaptcha.value.enabled && complaintCaptcha.value.provider === 'image') await loadComplaintCaptcha()
    complaintGeetestInstance?.reset?.()
  } finally {
    complaintSubmitting.value = false
  }
}

async function copyCurrentWindowLink() {
  const text = currentWindowLink.value
  let copied = false
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {}
  }
  if (!copied) copied = fallbackCopyText(text)
  showToast(copied ? '当前窗口链接已复制' : '复制失败，请长按链接复制')
}

function openGuestBinding() {
  showGuestAppBlocked.value = false
  showLogin.value = true
  authStep.value = 'account'
  authTab.value = 'login'
  loadCaptcha()
}

function goToAccount() {
  showDashboard.value = false
  if (isGuest.value) {
    guestPromptReason.value = 'account'
    showGuestAppBlocked.value = true
    return
  }
  router.push({ path: '/account', query: { channel: token.value } })
}

async function submitQQ() {
  qqErr.value = ''
  if (!/^[1-9]\d{4,11}$/.test(qqForm.value.qq)) {
    qqErr.value = '请输入5-12位有效QQ号'
    return
  }
  qqLoading.value = true
  try {
    const res = await api.post('/client/profile/qq', qqForm.value)
    if (res.code === 0) {
      customer.value = res.data
      showQQModal.value = false
    } else {
      qqErr.value = res.message || '提交失败'
    }
  } catch (e) {
    qqErr.value = e?.message || '网络错误'
  } finally {
    qqLoading.value = false
  }
}

async function loadConversation() {
  try {
    const res = await api.get('/client/conversation')
    if (isCurrentSession() && res.code === 0 && res.data) {
      if (String(res.data.tenantId) !== String(customer.value?.tenantId) ||
          String(res.data.channelId) !== String(customer.value?.channelId) ||
          String(res.data.customerId) !== String(customer.value?._id || customer.value?.id)) return
      conversation.value = res.data
      conversationStatus.value = res.data.status
      assignedAgentId.value = String(res.data.agent?.id || res.data.assignedAgentId || '')
      queryAgentPresence()
    }
  } catch {}
}

async function loadMessages(forceLatest = false) {
  if (!conversation.value?._id) return false
  const generation = ++sessionGeneration
  messageSyncInFlight = null
  messageRequestAbort?.abort()
  messageRequestAbort = new AbortController()
  const signal = messageRequestAbort.signal
  positionMode.value = 'latest'
  pendingMessages.value = 0
  positionAnchor = null

  if (!forceLatest) {
    const cached = await getCachedMessages(cacheScope.value, conversationCacheId.value)
    if (generation !== sessionGeneration || !isCurrentSession()) return false
    if (cached.length) messages.value = cached.filter(belongsToConversation)
    cleanupChatCache(cacheScope.value)
  }

  try {
    const res = await api.get('/client/conversation/messages', {
      params: { limit: 50 },
      signal,
    })
    if (generation !== sessionGeneration || !isCurrentSession()) return false
    if (res.code !== 0) return false
    messages.value = (res.data || []).filter(belongsToConversation)
    serverSnapshotCursor = messages.value.at(-1)?._id || null
    hasMoreMessages.value = messages.value.length === 50
    persistMessages()
    await nextTick()
    schedulePosition()
    return true
  } catch {
    return false
  }
}

async function syncLatestMessages() {
  if (document.visibilityState === 'hidden' || !customer.value || messageSyncInFlight || positionMode.value !== 'latest') return
  const generation = sessionGeneration
  const syncRun = {}
  messageSyncInFlight = syncRun
  try {
    let cursor = serverSnapshotCursor
    if (!cursor) return await loadMessages(true)
    let added = 0
    while (customer.value && generation === sessionGeneration) {
      const res = await api.get('/client/conversation/messages', { params: { limit: 50, after: cursor } })
      if (res.code !== 0 || generation !== sessionGeneration || !isCurrentSession()) break
      const page = (res.data || []).filter(belongsToConversation)
      page.forEach(message => { if (mergeMessage(message)) added++ })
      if (page.length) cursor = page.at(-1)._id
      if (page.length < 50) break
    }
    if (generation === sessionGeneration) {
      serverSnapshotCursor = cursor
      if (added) schedulePosition()
    }
  } catch {}
  finally {
    if (messageSyncInFlight === syncRun) messageSyncInFlight = null
  }
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  refreshChannelStatus()
  syncLatestMessages()
}

async function loadPreviousMessages() {
  if (loadingHistory.value || !hasMoreMessages.value || !messages.value.length) return
  const firstMessage = messages.value.find(message => message._id && !String(message._id).startsWith('temp_'))
  if (!firstMessage) return
  const generation = sessionGeneration
  loadingHistory.value = true
  positionMode.value = 'history'
  capturePosition()
  try {
    const res = await api.get('/client/conversation/messages', {
      params: { limit: 50, before: firstMessage._id },
    })
    if (generation !== sessionGeneration || !isCurrentSession()) return
    if (res.code === 0) {
      const olderMessages = (res.data || []).filter(belongsToConversation)
      const existingIds = new Set(messages.value.map(message => String(message._id)))
      messages.value = [
        ...olderMessages.filter(message => !existingIds.has(String(message._id))),
        ...messages.value,
      ]
      hasMoreMessages.value = olderMessages.length === 50
      await nextTick()
      restorePosition()
    }
  } catch {} finally {
    if (generation === sessionGeneration) loadingHistory.value = false
  }
}

function handlePositionInput(event) {
  const container = msgContainer.value
  if (!container) return
  if (event.type === 'touchstart') {
    positionTouchY = event.touches[0]?.clientY || 0
    return
  }
  if (event.type === 'keydown' && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
  if (event.type === 'pointerdown' && event.clientX < container.getBoundingClientRect().right - 18) return
  positionIntentUntil = performance.now() + 1200
  const upward = event.deltaY < 0 || ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
    (event.type === 'touchmove' && event.touches[0]?.clientY > positionTouchY)
  if (upward || event.type === 'pointerdown') {
    positionMode.value = 'history'
    capturePosition()
  }
}

function handleMessageScroll() {
  cancelLongPress()
  if (performance.now() > positionIntentUntil) return
  const container = msgContainer.value
  if (!container) return
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 24
  positionMode.value = nearBottom ? 'latest' : 'history'
  if (nearBottom) pendingMessages.value = 0
  capturePosition()
  if (!nearBottom && container.scrollTop <= 24) loadPreviousMessages()
}

function mergeMessage(message) {
  if (!isCurrentSession() || !message || deletedMessageIds.has(String(message._id))) return false
  if (!String(message._id || '').startsWith('temp_') && !belongsToConversation(message)) return false
  const index = messages.value.findIndex(item =>
    String(item._id) === String(message._id) ||
    (message.clientMessageId && item.clientMessageId === message.clientMessageId),
  )
  if (index >= 0) {
    // 重复新消息不能复活已经撤回的消息。
    const current = messages.value[index]
    if (!current.recalledAt) {
      if (current.localObjectUrl && current.localObjectUrl !== message.localObjectUrl) {
        URL.revokeObjectURL(current.localObjectUrl)
      }
      messages.value.splice(index, 1, message)
    }
    return false
  }

  messages.value.push(message)
  return true
}

function updatePendingMessage(clientMessageId, patch) {
  const message = messages.value.find(item => item.clientMessageId === clientMessageId)
  if (!message) return null
  Object.assign(message, patch)
  return message
}

function markMessageFailed(message) {
  const index = messages.value.findIndex(item => String(item._id) === String(message?._id))
  if (index < 0) return
  messages.value.splice(index, 1, { ...messages.value[index], sendFailed: true })
}

function showToast(message) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2200)
}

function imageCaption(msg) {
  const content = String(msg.content || '').trim()
  if (!content || ['[图片]', '[视频]'].includes(content) || content === String(msg.attachmentUrl || '').trim()) return ''
  return content
}

function parseMessageContent(content = '') {
  const urlPattern = /((?:https?:\/\/|www\.)[^\s<]+)/gi
  const parts = []
  let lastIndex = 0

  for (const match of String(content).matchAll(urlPattern)) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }

    const trailing = match[0].match(/[，。！？；：、,.!?;:]+$/)?.[0] || ''
    const text = trailing ? match[0].slice(0, -trailing.length) : match[0]
    parts.push({
      type: 'link',
      text,
      href: text.toLowerCase().startsWith('www.') ? `https://${text}` : text,
    })
    if (trailing) parts.push({ type: 'text', text: trailing })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) parts.push({ type: 'text', text: content.slice(lastIndex) })
  return parts.length ? parts : [{ type: 'text', text: content }]
}

function attachmentUrl(msg) { return msg.attachmentId ? `/api/files/${msg.attachmentId}` : msg.attachmentUrl }
function thumbnailUrl(msg) { return msg.attachmentId ? `/api/files/${msg.attachmentId}/thumbnail` : msg.thumbnailUrl }
function attachmentExpired(msg) { return Boolean(msg?.recalledAt || ['expired', 'recalled', 'deleted'].includes(msg?.attachmentStatus) || (msg?.attachmentExpiredAt && new Date(msg.attachmentExpiredAt).getTime() <= Date.now())) }
function releaseAttachmentUrls(msg, scope = cacheScope.value) {
  if (!msg) return
  for (const thumbnail of [false, true]) {
    const key = mediaKey(msg, thumbnail)
    const cacheKey = mediaCacheKey(scope, msg, thumbnail)
    mediaSubscriptions.get(key)?.()
    mediaSubscriptions.delete(key)
    if (mediaUrls.value[key]) releaseObjectUrl(cacheKey)
    delete mediaUrls.value[key]
    mediaRequests.delete(key)
  }
  if (preview.value?.msg === msg) closePreview()
}
function markAttachmentExpired(msg) {
  if (!msg) return
  msg.attachmentStatus = 'expired'
  releaseAttachmentUrls(msg)
  invalidateAttachment(cacheScope.value, msg.attachmentId)
  persistMessages()
}
function avatarSrc(url) { return avatarUrls.value[url] || url }
function customerAvatarVisible() { return Boolean(customer.value?.avatarUrl && !failedAvatarUrls.value[customer.value.avatarUrl]) }
function handleAvatarError(url) {
  if (!url) return
  failedAvatarUrls.value = { ...failedAvatarUrls.value, [url]: true }
}
function loadAvatar(el, url) {
  if (!url || avatarUrls.value[url] || !isPrivateAvatarUrl(url)) return
  if (!avatarRequests.has(url)) {
    const requestScope = cacheScope.value
    avatarRequests.set(url, loadCachedAvatar(requestScope, url, () => api.get(url, { baseURL: '', responseType: 'blob' }))
      .then(blob => {
        if (!blob || requestScope !== cacheScope.value || !el.isConnected) return
        avatarUrls.value[url] = acquireObjectUrl(avatarCacheKey(requestScope, url), blob)
        el.src = avatarUrls.value[url]
      })
      .catch(() => {})
      .finally(() => avatarRequests.delete(url)))
  }
}
const vCachedAvatar = { mounted(el, binding) { loadAvatar(el, binding.value) }, updated(el, binding) { if (binding.value !== binding.oldValue) loadAvatar(el, binding.value) } }
function mediaKey(msg, thumbnail = false) { return `${msg._id || msg.clientMessageId}:${thumbnail ? 'thumbnail' : 'original'}` }
function loadMedia(msg, thumbnail = false, onDownloadProgress) {
  if (!msg.attachmentId) return Promise.resolve(thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg))
  if (attachmentExpired(msg) || (msg.attachmentId && msg.attachmentStatus !== 'active')) return Promise.resolve('')
  // 每次视频预览独占 URL，避免旧预览释放新预览复用的 URL。
  const key = msg.messageType === 'video' && !thumbnail ? Symbol(mediaKey(msg, thumbnail)) : mediaKey(msg, thumbnail)
  if (mediaUrls.value[key]) return Promise.resolve(mediaUrls.value[key])
  if (!mediaRequests.has(key)) {
    const requestScope = cacheScope.value
    const request = loadCachedMedia(
      requestScope,
      msg,
      thumbnail,
      () => api.get(thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg), { baseURL: '', responseType: 'blob', timeout: 120000, onDownloadProgress }),
      () => api.get(`/files/${msg.attachmentId}/status`),
    ).then(blob => {
      if (!blob || mediaRequests.get(key) !== request || attachmentExpired(msg)) return ''
        if ((thumbnail || msg.messageType === 'image') && !blob.type.startsWith('image/')) return ''
      const cacheKey = mediaCacheKey(requestScope, msg, thumbnail)
      const url = acquireObjectUrl(cacheKey, blob)
      if (msg.messageType !== 'video' || thumbnail) {
        mediaUrls.value[key] = url
        mediaSubscriptions.get(key)?.()
        mediaSubscriptions.set(key, subscribePrivateMedia(cacheKey, () => {
          if (mediaUrls.value[key] !== url) return
          delete mediaUrls.value[key]
          mediaRequests.delete(key)
          msg.attachmentStatus = 'expired'
          if (preview.value?.msg === msg) closePreview()
          persistMessages()
        }))
      }
      return url
    })
      .catch(error => {
        if (mediaRequests.get(key) === request && [403, 404, 410].includes(error?.httpStatus)) markAttachmentExpired(msg)
        return ''
      })
      .finally(() => { if (mediaRequests.get(key) === request) mediaRequests.delete(key) })
    mediaRequests.set(key, request)
  }
  return mediaRequests.get(key)
}
function mediaSrc(msg, thumbnail = false) {
  if (msg.localObjectUrl && !thumbnail) return msg.localObjectUrl
  if (!msg.attachmentId) return thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg)
  return mediaUrls.value[mediaKey(msg, thumbnail)] || undefined
}
// 忆梦云团队开发：使用专用容器定位，不依赖直接父节点层级。
function handleChatMediaLoad(event) {
  const el = event.currentTarget
  if (!el.naturalWidth) return
  el.hidden = false
  const wrap = el.closest('.chat-media')
  const ratio = el.naturalWidth / el.naturalHeight
  if (wrap && Number.isFinite(ratio) && ratio > 0) {
    const isVideo = wrap.classList.contains('message-video-wrap')
    wrap.style.setProperty('--media-width', (isVideo ? 240 : Math.min(el.naturalWidth, 280, 220 * ratio)) + 'px')
    wrap.style.setProperty('--media-mobile-width', (isVideo ? 210 : Math.min(el.naturalWidth, 220, 180 * ratio)) + 'px')
    wrap.style.setProperty('--media-ratio', isVideo ? '16 / 10' : String(ratio))
    wrap.classList.add('has-media')
    wrap.classList.remove('media-error')
  }
  scheduleScroll(false)
}
function handleChatMediaError(event) {
  const el = event.currentTarget
  el.hidden = true
  const wrap = el.closest('.chat-media')
  wrap?.classList.remove('has-media')
  wrap?.classList.add('media-error')
  const label = wrap?.querySelector('.chat-media-placeholder')
  if (label) label.textContent = wrap.classList.contains('message-video-wrap') ? '封面不可用，点击重试' : '图片加载失败，点击重试'
}
function bindMedia(el, binding) {
  const { msg, thumbnail = false } = binding.value
  const signature = [mediaKey(msg, thumbnail), msg.attachmentId, msg.attachmentUrl, msg.thumbnailUrl, msg.localObjectUrl, msg.attachmentStatus, msg.recalledAt].join(':')
  if (el._mediaSignature === signature) return
  el._attachmentObserver?.disconnect()
  el._mediaSignature = signature
  const load = () => (msg.localObjectUrl && !thumbnail ? Promise.resolve(msg.localObjectUrl) : loadMedia(msg, thumbnail)).then(url => {
    if (!url && el.isConnected && el._mediaSignature === signature) handleChatMediaError({ currentTarget: el })
    if (url && el.isConnected && el._mediaSignature === signature && !attachmentExpired(msg)) { el.hidden = false; el.src = url }
  })
  if (!('IntersectionObserver' in window)) { load(); return }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load() }
  }, { rootMargin: '160px' })
  el._attachmentObserver = observer
  observer.observe(el.closest('.chat-media') || el)
}
const vLazyMedia = {
  mounted: bindMedia, updated: bindMedia,
  unmounted(el) { el._mediaSignature = ''; el._attachmentObserver?.disconnect() },
}
async function openPreview(msg) {
  if (attachmentExpired(msg)) return
  closePreview()
  preview.value = { url: '', type: msg.messageType, name: msg.attachmentName, msg, loading: true, error: false }
  const current = preview.value
  try {
    let url
    if (msg.messageType === 'video') {
      if (!msg.attachmentId) throw new Error('旧视频缺少受保护附件标识，请下载或重新上传')
      current.abort = new AbortController()
      const result = await api.post('/files/' + encodeURIComponent(msg.attachmentId) + '/playback', {}, { signal: current.abort.signal })
      if (preview.value !== current || attachmentExpired(msg)) return
      const data = result?.data
      if (!data || !new RegExp('^/api/files/' + msg.attachmentId + '/playback/[a-f0-9]{32}$').test(data.url)
        || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) throw new Error('播放授权无效，请重试')
      url = data.url
      current.expiresAt = data.expiresAt
      current.timer = setTimeout(() => {
        if (preview.value !== current) return
        stopPreviewVideo()
        current.url = ''
        current.loading = false
        current.error = true
        current.errorMessage = '播放授权已到期，点击重新授权播放'
      }, data.expiresAt - Date.now())
      current.buffering = true
    } else {
      url = await loadMedia(msg, false, event => {
        if (preview.value === current) current.progress = downloadProgressState(event)
      })
    }
    if (preview.value !== current || attachmentExpired(msg)) return
    current.url = url
    current.error = !url
  } catch (error) {
    if (preview.value === current) {
      if (error?.httpStatus === 410) { markAttachmentExpired(msg); return }
      current.error = true
      current.errorMessage = error?.message || '加载失败，点击重试'
    }
  } finally {
    if (preview.value === current) {
      current.loading = false
      if (!current.url) current.error = true
    }
  }
}
function stopPreviewVideo() {
  const video = previewVideo.value
  if (video) { video.pause(); video.removeAttribute('src'); video.load() }
}
function previewMediaEvent(event) {
  const current = preview.value
  if (!current || event.target !== previewVideo.value || !current.url || current.error) return
  if (Date.now() >= current.expiresAt) {
    stopPreviewVideo()
    current.url = ''
    current.error = true
    current.errorMessage = '播放授权已到期，点击重新授权播放'
    return
  }
  current.buffering = event.type === 'waiting' || event.type === 'loadedmetadata'
  if (event.type === 'error') {
    current.error = true
    current.errorMessage = '视频无法播放：格式/编码不支持、授权失效或网络异常，点击重试'
    clearTimeout(current.timer)
    stopPreviewVideo()
    current.url = ''
  }
}
function closePreview() {
  preview.value?.abort?.abort()
  clearTimeout(preview.value?.timer)
  stopPreviewVideo()
  preview.value = null
}
function isDownloaded(msg) {
  downloadedVersion.value
  if (!msg?.attachmentId) return false
  const bridge = getNativeAttachmentBridge()
  if (bridge) {
    try { return getNativeAttachmentState(bridge, cacheScope.value, msg.attachmentId).status === 'saved' } catch { return false }
  }
  return wasAttachmentDownloaded(localStorage, cacheScope.value, msg.attachmentId)
}

function handleNativeAttachment(event) {
  const detail = event?.detail || {}
  if (!detail.attachmentId) return
  if (detail.status === 'progress') downloadProgress.value = downloadProgressState(detail)
  if (detail.status === 'saved') {
    markAttachmentDownloaded(localStorage, cacheScope.value, detail.attachmentId)
    downloadedVersion.value += 1
    downloadProgress.value = { status: 'success', loaded: detail.loaded, total: detail.total, computable: true, percent: 100 }
    showToast('文件已保存')
    setTimeout(() => { downloadProgress.value = null }, 1800)
  }
  if (detail.status === 'failed') {
    clearAttachmentDownloaded(localStorage, cacheScope.value, detail.attachmentId)
    downloadedVersion.value += 1
    if (Number(detail.httpStatus) === 410) {
      const msg = messages.value.find(item => String(item.attachmentId) === String(detail.attachmentId))
      markAttachmentExpired(msg)
    }
    downloadProgress.value = { ...downloadProgress.value, status: 'failed' }
    showToast(detail.message || '下载失败')
    setTimeout(() => { downloadProgress.value = null }, 1800)
  }
}

async function downloadFile(msgOrUrl, name = '下载文件') {
  contextMenu.value = null
  const msg = typeof msgOrUrl === 'object' ? msgOrUrl : null
  if (attachmentExpired(msg)) return
  const url = msg ? attachmentUrl(msg) : msgOrUrl
  const fileName = msg?.attachmentName || name
  const shouldShare = isDownloaded(msg)
  const bridge = msg?.attachmentId ? getNativeAttachmentBridge() : null
  downloadProgress.value = { status: 'downloading', loaded: 0, total: 0, computable: false, percent: null }
  if (bridge) {
    try {
      if (shouldShare) {
        const opened = openNativeAttachment(bridge, cacheScope.value, msg.attachmentId)
        if (opened.status !== 'missing') {
          if (opened.status === 'no_handler' || opened.status === 'error') showToast(opened.message || '无法打开文件')
          downloadProgress.value = null
          return
        }
        clearAttachmentDownloaded(localStorage, cacheScope.value, msg.attachmentId)
        downloadedVersion.value += 1
      }
      const started = saveNativeAttachment(
        bridge,
        cacheScope.value,
        msg.attachmentId,
        fileName,
        msg.attachmentMimeType || 'application/octet-stream',
      )
      if (started.status === 'busy') showToast(started.message || '文件正在保存')
      else if (started.status !== 'started') throw new Error(started.message || '无法开始保存文件')
    } catch (error) {
      downloadProgress.value = { ...downloadProgress.value, status: 'failed' }
      showToast(error?.message || '下载失败')
      setTimeout(() => { downloadProgress.value = null }, 1800)
    }
    return
  }
  try {
    const blob = await api.get(url, {
      baseURL: '', responseType: 'blob', timeout: 120000,
      onDownloadProgress: event => { downloadProgress.value = downloadProgressState(event) },
    })
    downloadProgress.value = { status: 'success', loaded: blob.size, total: blob.size, computable: true, percent: 100 }
    const sharedFile = shouldShare ? canShareBlob(navigator, blob, fileName) : null
    if (sharedFile) {
      try {
        await navigator.share({ files: [sharedFile], title: sharedFile.name })
        showToast('已打开分享/应用选择')
      } catch (error) {
        if (error?.name === 'AbortError') return
        saveBlob(blob, fileName)
        showToast('分享不可用，已下载')
      }
    } else {
      saveBlob(blob, fileName)
      showToast(shouldShare ? '当前环境不支持文件分享，已下载' : '文件已保存')
    }
    if (msg?.attachmentId) {
      markAttachmentDownloaded(localStorage, cacheScope.value, msg.attachmentId)
      downloadedVersion.value += 1
    }
  } catch (error) {
    if (error?.httpStatus === 410) markAttachmentExpired(msg)
    downloadProgress.value = { ...downloadProgress.value, status: 'failed' }
    showToast(error?.httpStatus === 410 ? '该文件已过期并自动清理' : '下载失败')
  } finally {
    setTimeout(() => { downloadProgress.value = null }, 1800)
  }
}

function showContextMenu(event, msg) {
  event.preventDefault()
  const menuWidth = 140
  const menuHeight = canDeleteMessage(msg) ? 136 : 52
  const x = Math.max(8, Math.min(event.clientX || innerWidth / 2, innerWidth - menuWidth - 8))
  const y = Math.max(8, Math.min(event.clientY || innerHeight / 2, innerHeight - menuHeight - 8))
  contextMenu.value = { msg, x, y }
}

function closeContextMenu() {
  contextMenu.value = null
}

function startLongPress(event, msg) {
  clearTimeout(longPressTimer)
  const point = event.touches?.[0]
  if (!point) return
  longPressStart = { x: point.clientX, y: point.clientY }
  const position = { preventDefault() {}, clientX: point.clientX, clientY: point.clientY }
  longPressTimer = setTimeout(() => {
    suppressBubbleClickUntil = Date.now() + 700
    showContextMenu(position, msg)
  }, 550)
}

function moveLongPress(event) {
  const point = event.touches?.[0]
  if (!point || !longPressStart) return
  if (Math.hypot(point.clientX - longPressStart.x, point.clientY - longPressStart.y) > 10) cancelLongPress()
}

function finishLongPress() {
  cancelLongPress()
}

function cancelLongPress() {
  clearTimeout(longPressTimer)
  longPressStart = null
}

function handleBubbleClick(event) {
  if (Date.now() >= suppressBubbleClickUntil) return
  event.preventDefault()
  event.stopPropagation()
}

function canDeleteMessage(msg) {
  return msg.senderType !== 'system' && msg._id && !String(msg._id).startsWith('temp_')
}

function canRecallMessage(msg) {
  return msg.senderType === 'customer' && canDeleteMessage(msg) && !msg.recalledAt &&
    Date.now() - new Date(msg.createdAt).getTime() <= 2 * 60 * 1000
}

function videoPosterUrl(msg) {
  if (msg.attachmentId) return mediaSrc(msg, true)
  if (msg.thumbnailUrl) return msg.thumbnailUrl
  if (!msg.attachmentUrl) return ''
  return msg.attachmentUrl.replace(/\.[^./?#]+(?:[?#].*)?$/, '.thumbnail.jpg')
}

function handleVideoThumbnailLoad(event) {
  event.currentTarget.hidden = false
  event.currentTarget.closest('.message-video-wrap')?.classList.remove('has-thumbnail-error')
  event.currentTarget.classList.add('is-loaded')
  event.currentTarget.closest('.message-video-wrap')?.classList.add('has-thumbnail')
  scheduleScroll(false)
}

function handleVideoThumbnailError(event) {
  if (!event.currentTarget.getAttribute('src')) return
  event.currentTarget.hidden = true
  event.currentTarget.closest('.message-video-wrap')?.classList.add('has-thumbnail-error')
}

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

async function copyMessage(msg) {
  const text = String(msg.content || '')
  try {
    if (!text) throw new Error('没有可复制的内容')
    let copied = false
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch {}
    }
    if (!copied) copied = fallbackCopyText(text)
    if (!copied) throw new Error('复制失败')
    showToast('已复制')
  } catch { showToast('复制失败') }
  contextMenu.value = null
}

async function recallMessage(msg) {
  contextMenu.value = null
  try {
    const res = await api.post(`/client/conversation/messages/${msg._id}/recall`)
    if (res.code !== 0) throw new Error(res.message || '撤回失败')
    applyRecall(res.data || { conversationId: msg.conversationId, messageId: msg._id, recalledAt: new Date().toISOString() })
    showToast('消息已撤回')
  } catch (error) {
    showToast(error?.message || '撤回失败')
  }
}

async function deleteMessage(msg) {
  contextMenu.value = null
  try {
    const res = await api.delete(`/client/conversation/messages/${msg._id}`)
    if (res.code !== 0) throw new Error(res.message || '删除失败')
    applyDelete(res.data || { conversationId: msg.conversationId, messageId: msg._id })
    showToast('消息已删除')
  } catch (error) {
    showToast(error?.message || '删除失败')
  }
}

function applyRecall(data) {
  if (!belongsToConversation(data)) return
  const messageId = data.messageId || data._id
  const msg = messages.value.find(item => String(item._id) === String(messageId))
  if (msg) {
    releaseAttachmentUrls(msg)
    Object.assign(msg, data, { recalledAt: data.recalledAt || new Date().toISOString(), attachmentStatus: 'recalled', content: '', attachmentUrl: '', attachmentName: '', thumbnailUrl: '' })
    if (msg.attachmentId) invalidateAttachment(cacheScope.value, msg.attachmentId, 'recalled')
    persistMessages()
  }
}

function applyDelete(data) {
  if (!belongsToConversation(data) || (data.side && data.side !== 'customer')) return
  deletedMessageIds.add(String(data.messageId || data._id))
  const messageId = data.messageId || data._id
  const msg = messages.value.find(item => String(item._id) === String(messageId))
  if (msg) releaseAttachmentUrls(msg)
  if (msg?.attachmentId) invalidateAttachment(cacheScope.value, msg.attachmentId, 'deleted')
  messages.value = messages.value.filter(item => String(item._id) !== String(messageId))
  persistMessages()
}

function applyAttachmentUpdate(data) {
  if (!belongsToConversation(data)) return
  const msg = messages.value.find(item => String(item._id) === String(data.messageId))
  if (!msg || !['expired', 'recalled', 'deleted'].includes(data.status)) return
  msg.attachmentStatus = data.status
  releaseAttachmentUrls(msg)
  invalidateAttachment(cacheScope.value, data.attachmentId || msg.attachmentId, data.status)
  persistMessages()
}

async function handleAttachment(event, messageType) {
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value || !customer.value) return

  uploading.value = true
  const clientMessageId = createClientMessageId('c_attachment')
  const localMsg = {
    _id: `temp_${clientMessageId}`,
    clientMessageId,
    conversationId: conversation.value?._id,
    senderType: 'customer',
    createdAt: new Date().toISOString(),
    attachmentName: file.name,
    messageType,
    localObjectUrl: messageType === 'image' ? URL.createObjectURL(file) : '',
    uploadPhase: 'uploading',
    uploadProgress: 0,
  }
  mergeMessage(localMsg)
  showAttachments.value = false
  await scrollOwnMessageToBottom()
  try {
    const formData = new FormData()
    formData.append('file', file)
    // #region debug-point A-D:client-upload-zero
    fetch(`/api/__debug_client_upload_zero/start?size=${encodeURIComponent(file.size)}&type=${encodeURIComponent(messageType)}`, { credentials: 'same-origin' }).catch(() => {})
    // #endregion
    const uploadRes = await api.post('/client/conversation/attachments', formData, {
      timeout: 120000,
      onUploadProgress: event => {
        // #region debug-point A-D:client-upload-zero
        const pendingExists = Boolean(messages.value.find(item => item.clientMessageId === clientMessageId))
        fetch(`/api/__debug_client_upload_zero/progress?loaded=${encodeURIComponent(event.loaded ?? '')}&total=${encodeURIComponent(event.total ?? '')}&computable=${encodeURIComponent(event.lengthComputable ?? '')}&progress=${encodeURIComponent(event.progress ?? '')}&pending=${pendingExists ? 1 : 0}`, { credentials: 'same-origin' }).catch(() => {})
        // #endregion
        updatePendingMessage(clientMessageId, {
          uploadProgress: event.total ? Math.min(100, Math.round(event.loaded * 100 / event.total)) : 0,
        })
      },
    })
    if (uploadRes.code !== 0) throw new Error(uploadRes.message || '上传失败')

    const effectiveType = ['image', 'video'].includes(uploadRes.data.category) ? uploadRes.data.category : 'file'
    Object.assign(localMsg, {
      attachmentId: uploadRes.data.attachmentId,
      attachmentName: uploadRes.data.name || file.name,
      attachmentStatus: uploadRes.data.status,
      messageType: effectiveType,
      uploadPhase: 'sending',
      uploadProgress: 100,
    })
    const payload = { attachmentId: localMsg.attachmentId, clientMessageId, messageType: effectiveType }
    const res = await api.post('/client/conversation/messages', payload)
    if (res.code !== 0) throw new Error(res.message || '发送失败')
    mergeMessage(res.data?.message)
    mergeMessage(res.data?.botReply)
    scrollToBottom()
  } catch (error) {
    localMsg.uploadPhase = 'failed'
    localMsg.sendFailed = true
    showToast(error?.message || '附件发送失败')
    await nextTick()
    scrollToBottom()
  } finally {
    uploading.value = false
  }
}

function handleMessageEnter(event) {
  if (event.isComposing) return
  event.preventDefault()
  sendMessage()
}

async function sendMessage() {
  if (!inputText.value.trim() || sending.value || uploading.value) return
  sending.value = true
  
  const clientMessageId = 'c_' + Date.now()
  const localMsg = {
    _id: 'temp_' + Date.now(),
    clientMessageId,
    senderType: 'customer',
    content: inputText.value.trim(),
    createdAt: new Date().toISOString(),
  }
  messages.value.push(localMsg)
  const text = inputText.value.trim()
  inputText.value = ''
  await nextTick()
  scrollToBottom()
  
  try {
    const res = await api.post('/client/conversation/messages', {
      content: text,
      clientMessageId,
    })
    if (res.code === 0) {
      const result = res.data || {}
      const message = result.message
      const botReply = result.botReply
      mergeMessage(message)
      mergeMessage(botReply)
      await scrollOwnMessageToBottom()
    }
  } catch (e) {
    if (e?.code === 4034) {
      markMessageFailed(localMsg)
      await nextTick()
      scrollToBottom()
    } else {
      messages.value = messages.value.filter(m => m._id !== localMsg._id)
      if (e?.code === 4035) window.alert(e.message)
    }
  } finally {
    sending.value = false
  }
}

function handleNewMessage(msg) {
  if (!belongsToConversation(msg)) return
  const isNewMessage = mergeMessage(msg)
  if (!isNewMessage) return
  if (['agent', 'bot'].includes(msg.senderType)) playNotificationSound()
  scheduleScroll(false)
}

function queryAgentPresence() {
  const queryVersion = ++presenceQueryVersion
  if (channel.value?.status !== 'online') {
    applyAgentOnline(false)
    return
  }
  if (!socket?.connected) return
  const agentIds = assignedAgentId.value
    ? [assignedAgentId.value]
    : (channel.value?.agentIds || []).map(String)
  if (!agentIds.length) {
    applyAgentOnline(false)
    return
  }
  let pending = agentIds.length
  let anyOnline = false
  agentIds.forEach(userId => {
    socket.emit('presence:query', { type: 'tenant_user', userId }, ({ online } = {}) => {
      if (queryVersion !== presenceQueryVersion) return
      anyOnline = anyOnline || Boolean(online)
      pending -= 1
      if (!pending) applyAgentOnline(anyOnline)
    })
  })
}

function handlePresenceChanged(data) {
  if (data.type !== 'tenant_user') return
  const relevantIds = assignedAgentId.value
    ? [assignedAgentId.value]
    : (channel.value?.agentIds || []).map(String)
  if (relevantIds.includes(String(data.userId))) queryAgentPresence()
}

function handleConversationUpdated(data) {
  if (!belongsToConversation(data)) return
  if (data.status) conversationStatus.value = data.status
  const agentId = data.agent?.id || data.assignedAgentId
  if (agentId) {
    assignedAgentId.value = String(agentId)
    queryAgentPresence()
  }
}

function handleConversationClosed(data) {
  if (!belongsToConversation(data)) return
  conversationStatus.value = data.status || 'closed'
  if (conversation.value) conversation.value = { ...conversation.value, ...data }
  scheduleScroll(false)
}

function handleSocketConnect() {
  syncLatestMessages()
  queryAgentPresence()
}

function setupSocket() {
  if (!isCurrentSession()) return
  const savedToken = localStorage.getItem('client_token')
  if (!savedToken) return

  socket = getSocket(savedToken)
  socket.off('connect', handleSocketConnect)
  socket.off('message.new', handleNewMessage)
  socket.off('message.recalled', applyRecall)
  socket.off('message.deleted', applyDelete)
  socket.off('attachment.updated', applyAttachmentUpdate)
  socket.off('conversation.updated', handleConversationUpdated)
  socket.off('conversation.closed', handleConversationClosed)
  socket.off('presence:changed', handlePresenceChanged)
  socket.on('message.new', handleNewMessage)
  socket.on('connect', handleSocketConnect)
  socket.on('message.recalled', applyRecall)
  socket.on('message.deleted', applyDelete)
  socket.on('attachment.updated', applyAttachmentUpdate)
  socket.on('conversation.updated', handleConversationUpdated)
  socket.on('conversation.closed', handleConversationClosed)
  socket.on('presence:changed', handlePresenceChanged)
}

function capturePosition() {
  const container = msgContainer.value
  if (!container) return
  const top = container.getBoundingClientRect().top
  const row = [...container.querySelectorAll('[data-message-id]')]
    .find(item => item.getBoundingClientRect().bottom > top + 1)
  if (row) {
    positionAnchor = {
      id: row.dataset.messageId,
      offset: row.getBoundingClientRect().top - top,
      height: container.scrollHeight,
    }
  }
}

function restorePosition() {
  const container = msgContainer.value
  if (!container) return
  if (positionMode.value === 'latest') {
    container.scrollTop = container.scrollHeight
    return
  }
  if (!positionAnchor) return
  const row = [...container.querySelectorAll('[data-message-id]')]
    .find(item => item.dataset.messageId === positionAnchor.id)
  if (row) {
    container.scrollTop += row.getBoundingClientRect().top -
      container.getBoundingClientRect().top - positionAnchor.offset
  } else if (Number.isFinite(positionAnchor.height)) {
    container.scrollTop += container.scrollHeight - positionAnchor.height
  }
  positionAnchor.height = container.scrollHeight
}

async function schedulePosition() {
  const generation = sessionGeneration
  await nextTick()
  cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null
    if (generation === sessionGeneration) restorePosition()
  })
}

function observeMessageLayout() {
  positionObserver?.disconnect()
  positionMutation?.disconnect()
  const container = msgContainer.value
  if (!container) return
  container.style.overflowAnchor = 'none'
  positionObserver = new ResizeObserver(schedulePosition)
  positionObserver.observe(container)
  container.querySelectorAll('[data-message-id]').forEach(row => positionObserver.observe(row))
  positionMutation = new MutationObserver(() => {
    observeMessageLayout()
    schedulePosition()
  })
  positionMutation.observe(container, { childList: true, subtree: true })
}

function scheduleScroll(force = true) {
  if (force) {
    positionMode.value = 'latest'
    pendingMessages.value = 0
  }
  return schedulePosition()
}

function scrollToBottom() {
  return scheduleScroll(true)
}

async function returnToLatest() {
  const loaded = await loadMessages(true)
  if (loaded) schedulePosition()
}

function updateViewport() {
  const viewport = window.visualViewport
  viewportHeight.value = `${Math.round(viewport?.height || window.innerHeight)}px`
  viewportTop.value = `${Math.round(viewport?.offsetTop || 0)}px`
  schedulePosition()
}

function handleComposerFocus() {
  showAttachments.value = false
  requestAnimationFrame(() => scheduleScroll(true))
}

function scrollOwnMessageToBottom() {
  return scheduleScroll(true)
}

watch(msgContainer, () => {
  observeMessageLayout()
  schedulePosition()
}, { flush: 'post' })

watch(() => messages.value.length, () => {
  observeMessageLayout()
  schedulePosition()
}, { flush: 'post' })

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toTimeString().slice(0, 5)
  }
  return `${d.getMonth()+1}/${d.getDate()} ${d.toTimeString().slice(0, 5)}`
}

function formatDate(iso) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

function formatDateTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function generateFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
  ].join('|')
  return btoa(raw)
}

onMounted(() => {
  window.addEventListener('yimeng-native-attachment', handleNativeAttachment)
  window.addEventListener('pointerdown', unlockNotificationSound, { once: true })
  window.addEventListener('keydown', unlockNotificationSound, { once: true })
  updateViewport()
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  messageSyncTimer = setInterval(syncLatestMessages, 30000)
  channelStatusTimer = setInterval(refreshChannelStatus, 15000)
  loadChannel()
})

watch(cacheScope, (scope, previousScope) => {
  if (previousScope && previousScope !== scope) {
    closePreview()
    messages.value.forEach(msg => releaseAttachmentUrls(msg, previousScope))
    Object.keys(avatarUrls.value).forEach(url => releaseObjectUrl(avatarCacheKey(previousScope, url)))
    avatarUrls.value = {}
    avatarRequests.clear()
  }
  if (scope) initializeChatCache(scope)
}, { immediate: true })

onUnmounted(() => {
  window.removeEventListener('yimeng-native-attachment', handleNativeAttachment)
  sessionActive = false
  window.removeEventListener('pointerdown', unlockNotificationSound)
  window.removeEventListener('keydown', unlockNotificationSound)
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.visualViewport?.removeEventListener('scroll', updateViewport)
  window.removeEventListener('resize', updateViewport)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  clearInterval(messageSyncTimer)
  clearInterval(channelStatusTimer)
  clearInterval(codeCountdownTimer)
  clearInterval(resetCodeTimer)
  clearInterval(complaintEmailCodeTimer)
  clearTimeout(toastTimer)
  clearTimeout(longPressTimer)
  sessionGeneration++
  messageRequestAbort?.abort()
  positionObserver?.disconnect()
  positionMutation?.disconnect()
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  geetestInstance?.destroy?.()
  complaintGeetestInstance?.destroy?.()
  if (socket) {
    socket.off('message.new', handleNewMessage)
    socket.off('connect', handleSocketConnect)
    socket.off('message.recalled', applyRecall)
    socket.off('message.deleted', applyDelete)
    socket.off('attachment.updated', applyAttachmentUpdate)
    socket.off('conversation.updated', handleConversationUpdated)
    socket.off('conversation.closed', handleConversationClosed)
    socket.off('presence:changed', handlePresenceChanged)
    socket.disconnect()
  }
  notificationAudioContext?.close().catch(() => {})
  notificationAudioContext = null
  closePreview()
  mediaRequests.clear()
  mediaSubscriptions.forEach(unsubscribe => unsubscribe())
  mediaSubscriptions.clear()
  messages.value.forEach(msg => {
    if (msg.localObjectUrl) URL.revokeObjectURL(msg.localObjectUrl)
    for (const thumbnail of [false, true]) if (mediaUrls.value[mediaKey(msg, thumbnail)]) releaseObjectUrl(mediaCacheKey(cacheScope.value, msg, thumbnail))
  })
  Object.keys(avatarUrls.value).forEach(url => releaseObjectUrl(avatarCacheKey(cacheScope.value, url)))
})
</script>