import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { Mic, SendHorizontal } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'

// ---------------------------------------------------------------------------
// Web Speech API 最小类型声明(lib.dom 未内置 SpeechRecognition)
// ---------------------------------------------------------------------------
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

/** 浏览器能力探测:不支持 Web Speech API 时麦克风按钮整体隐藏 */
const SR_CTOR: SpeechRecognitionCtor | undefined =
  typeof window !== 'undefined'
    ? window.SpeechRecognition ?? window.webkitSpeechRecognition
    : undefined

/** 录音中红色脉冲动画(keyframes 全局唯一前缀,避免与其他模块冲突) */
const MIC_PULSE_CSS =
  '@keyframes ct-mic-pulse{0%{box-shadow:0 0 0 0 rgba(255,77,79,.55)}70%{box-shadow:0 0 0 9px rgba(255,77,79,0)}100%{box-shadow:0 0 0 0 rgba(255,77,79,0)}}'

/** 指挥台输入栏:Enter / 发送按钮提交 campusStore.submitCommand;麦克风走 Web Speech API 语音转文字 */
export default function ChatInput() {
  const submitCommand = useCampusStore((s) => s.submitCommand)
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)

  const submit = () => {
    const t = text.trim()
    if (!t || pending) return
    setPending(true)
    setText('')
    void submitCommand(t).finally(() => setPending(false))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法组合中不触发提交
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  /** 开始/停止语音输入;识别结果只填入输入框,不自动发送,用户确认后再发 */
  const toggleVoice = () => {
    if (!SR_CTOR) return
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = new SR_CTOR()
    rec.lang = 'zh-CN'
    rec.continuous = false
    rec.interimResults = true // 边说边回填,便于用户即时校对
    rec.onresult = (e) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript
      }
      setText(transcript)
    }
    const settle = () => {
      setListening(false)
      recRef.current = null
    }
    rec.onend = settle
    rec.onerror = settle // 无权限/无语音等错误统一回到静止态
    recRef.current = rec
    setListening(true)
    try {
      rec.start()
    } catch {
      settle()
    }
  }

  // 卸载时中止识别,避免回调悬挂
  useEffect(() => () => recRef.current?.abort(), [])

  return (
    <div style={styles.row}>
      {SR_CTOR ? <style>{MIC_PULSE_CSS}</style> : null}
      <input
        style={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={listening ? '正在聆听,请说出指令…' : '下达指令,如:帮我找一个 10 人会议室'}
        aria-label="指挥指令输入"
      />
      {SR_CTOR ? (
        <button
          type="button"
          style={{ ...styles.iconBtn, ...(listening ? styles.micBtnLive : styles.micBtn) }}
          onClick={toggleVoice}
          title={listening ? '停止语音输入' : '语音输入(普通话)'}
          aria-label={listening ? '停止语音输入' : '开始语音输入'}
          aria-pressed={listening}
        >
          <Mic size={16} />
        </button>
      ) : null}
      <button
        type="button"
        style={{
          ...styles.iconBtn,
          ...styles.sendBtn,
          ...(text.trim() && !pending ? null : styles.btnDisabled),
        }}
        onClick={submit}
        disabled={!text.trim() || pending}
        title="发送指令"
        aria-label="发送指令"
      >
        <SendHorizontal size={16} />
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderTop: '1px solid #2a323b',
    background: '#14181d',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    background: '#0e1114',
    border: '1px solid #2a323b',
    borderRadius: 6,
    color: '#dde3e8',
    fontSize: 13,
    lineHeight: '20px',
    padding: '7px 10px',
    outline: 'none',
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 6,
    border: '1px solid #2a323b',
    background: '#161b21',
    color: '#dde3e8',
    cursor: 'pointer',
    flexShrink: 0,
  },
  micBtn: {
    color: '#9aa4ae',
  },
  micBtnLive: {
    background: '#d4380d',
    borderColor: '#ff4d4f',
    color: '#ffffff',
    animation: 'ct-mic-pulse 1.2s ease-out infinite',
  },
  sendBtn: {
    background: '#3aa7ff',
    borderColor: '#3aa7ff',
    color: '#0e1114',
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
}
