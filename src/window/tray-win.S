.intel_syntax noprefix
.text
.globl hook_proc
.globl wnd_proc
.globl hook_data

# rbx = hook_data. Offsets are label differences, so the copied page stays valid.

hook_proc:
  push rbx
  push rsi
  push r12
  sub rsp, 48
  mov r12d, ecx
  mov qword ptr [rsp + 32], rdx
  mov qword ptr [rsp + 40], r8
  lea rbx, [rip + hook_data]
  cmp r12d, 5
  jne hook_not_activate
  mov rcx, rdx
  call try_subclass
  jmp hook_next
hook_not_activate:
  cmp dword ptr [rbx + 136], 0
  je hook_next
  cmp r12d, 8
  jne hook_next
  cmp dword ptr [rbx + 140], 0
  jne hook_next
  mov eax, edx
  and eax, 0xFFF0
  cmp eax, 0xF060
  jne hook_next
  call qword ptr [rbx + 24]
  test rax, rax
  jz hook_next
  mov rsi, rax
  mov rcx, rsi
  call try_subclass
  mov rcx, rsi
  call title_matches
  test eax, eax
  jz hook_next
  call hide_to_tray
  mov eax, 1
  jmp hook_leave
hook_next:
  mov rcx, qword ptr [rbx + 112]
  mov edx, r12d
  mov r8, qword ptr [rsp + 32]
  mov r9, qword ptr [rsp + 40]
  call qword ptr [rbx + 0]
hook_leave:
  add rsp, 48
  pop r12
  pop rsi
  pop rbx
  ret

# rcx = hwnd. eax = 1 when the title is PromptDeck.
title_matches:
  push rbx
  sub rsp, 32
  lea rbx, [rip + hook_data]
  mov rdx, rcx
  lea rdx, [rbx + 184]
  mov r8d, 32
  call qword ptr [rbx + 32]
  lea rax, [rbx + 160]
  lea rcx, [rbx + 184]
  mov edx, 11
title_loop:
  movzx r10d, word ptr [rax]
  cmp r10w, word ptr [rcx]
  jne title_no
  add rax, 2
  add rcx, 2
  dec edx
  jnz title_loop
  mov eax, 1
  jmp title_done
title_no:
  xor eax, eax
title_done:
  add rsp, 32
  pop rbx
  ret

# rcx = hwnd
try_subclass:
  push rbx
  push rsi
  sub rsp, 40
  mov rsi, rcx
  lea rbx, [rip + hook_data]
  cmp dword ptr [rbx + 148], 0
  jne try_done
  mov rcx, rsi
  call title_matches
  test eax, eax
  jz try_done
  mov rcx, rsi
  mov edx, -4
  lea r8, [rip + wnd_proc]
  call qword ptr [rbx + 40]
  test rax, rax
  jz try_done
  mov qword ptr [rbx + 120], rax
  mov qword ptr [rbx + 128], rsi
  mov dword ptr [rbx + 148], 1
try_done:
  add rsp, 40
  pop rsi
  pop rbx
  ret

# rsi = hwnd, rbx = hook_data
hide_to_tray:
  push rbx
  sub rsp, 32
  lea rbx, [rip + hook_data]
  mov rcx, rsi
  xor edx, edx
  call qword ptr [rbx + 16]
  mov qword ptr [rbx + 128], rsi
  lea rax, [rbx + 272]
  mov qword ptr [rax + 8], rsi
  cmp dword ptr [rbx + 152], 0
  jne hide_mark
  xor ecx, ecx
  mov rdx, rax
  call qword ptr [rbx + 64]
  mov dword ptr [rbx + 152], 1
hide_mark:
  mov dword ptr [rbx + 144], 1
  add rsp, 32
  pop rbx
  ret

wnd_proc:
  push rbx
  push rsi
  push rdi
  push r12
  sub rsp, 72
  mov rsi, rcx
  mov edi, edx
  mov r12, r8
  mov qword ptr [rsp + 64], r9
  lea rbx, [rip + hook_data]
  cmp edi, 0x10
  jne wnd_not_close
  cmp dword ptr [rbx + 136], 0
  je wnd_forward
  cmp dword ptr [rbx + 140], 0
  jne wnd_forward
  call hide_to_tray
  xor eax, eax
  jmp wnd_leave
wnd_not_close:
  cmp edi, 0x312
  jne wnd_not_hotkey
  cmp r12d, 0x4b1
  jne wnd_forward
  mov qword ptr [rbx + 128], rsi
  mov rcx, rsi
  mov edx, 9
  call qword ptr [rbx + 16]
  mov rcx, qword ptr [rbx + 120]
  test rcx, rcx
  jz wnd_show
  mov rdx, rsi
  mov r8d, 0x112
  mov r9d, 0xF120
  mov qword ptr [rsp + 32], 0
  call qword ptr [rbx + 8]
  jmp wnd_show
wnd_not_hotkey:
  cmp edi, 0x8002
  jne wnd_not_bind
  call apply_hotkey
  xor eax, eax
  jmp wnd_leave
wnd_not_bind:
  cmp edi, 0x8001
  jne wnd_forward
  mov eax, dword ptr [rsp + 64]
  and eax, 0xFFFF
  cmp eax, 0x202
  je wnd_show
  cmp eax, 0x203
  je wnd_show
  cmp eax, 0x205
  jne wnd_zero
  call qword ptr [rbx + 72]
  mov rdi, rax
  test rdi, rdi
  jz wnd_zero
  mov rcx, rdi
  xor edx, edx
  mov r8d, 1
  lea r9, [rbx + 248]
  call qword ptr [rbx + 80]
  mov rcx, rdi
  xor edx, edx
  mov r8d, 2
  lea r9, [rbx + 256]
  call qword ptr [rbx + 80]
  lea rcx, [rbx + 264]
  call qword ptr [rbx + 104]
  mov rcx, qword ptr [rbx + 128]
  call qword ptr [rbx + 48]
  mov rcx, rdi
  mov edx, 0x180
  mov r8d, dword ptr [rbx + 264]
  mov r9d, dword ptr [rbx + 268]
  mov qword ptr [rsp + 32], 0
  mov rax, qword ptr [rbx + 128]
  mov qword ptr [rsp + 40], rax
  mov qword ptr [rsp + 48], 0
  call qword ptr [rbx + 88]
  mov r12d, eax
  mov rcx, rdi
  call qword ptr [rbx + 96]
  cmp r12d, 1
  je wnd_show
  cmp r12d, 2
  jne wnd_zero
  mov dword ptr [rbx + 140], 1
  mov dword ptr [rbx + 144], 0
  mov rcx, qword ptr [rbx + 128]
  mov edx, 0x10
  xor r8, r8
  xor r9, r9
  call qword ptr [rbx + 56]
  jmp wnd_zero
wnd_show:
  mov rcx, qword ptr [rbx + 128]
  mov edx, 5
  call qword ptr [rbx + 16]
  mov rcx, qword ptr [rbx + 128]
  call qword ptr [rbx + 48]
  mov dword ptr [rbx + 144], 0
wnd_zero:
  xor eax, eax
  jmp wnd_leave
wnd_forward:
  mov rcx, qword ptr [rbx + 120]
  mov rdx, rsi
  mov r8d, edi
  mov r9, r12
  mov rax, qword ptr [rsp + 64]
  mov qword ptr [rsp + 32], rax
  call qword ptr [rbx + 8]
wnd_leave:
  add rsp, 72
  pop r12
  pop rdi
  pop rsi
  pop rbx
  ret

# rsi = the window that received 0x8002. RegisterHotKey has to run on the thread
# that created that window. Result: 1 registered, 2 already taken (1409), 3 other.
# hook_data offsets: RegisterHotKey 1248, UnregisterHotKey 1256, GetLastError 1264,
# mods 1272, vk 1276, seq 1280, done 1284, result 1288, error 1292.
apply_hotkey:
  push rbx
  push rsi
  sub rsp, 40
  lea rbx, [rip + hook_data]
  mov rcx, rsi
  mov edx, 0x4b1
  call qword ptr [rbx + 1256]
  mov r8d, dword ptr [rbx + 1272]
  mov r9d, dword ptr [rbx + 1276]
  test r8d, r8d
  jz apply_ok
  test r9d, r9d
  jz apply_ok
  mov rcx, rsi
  mov edx, 0x4b1
  call qword ptr [rbx + 1248]
  test eax, eax
  jnz apply_ok
  mov r8d, dword ptr [rbx + 1272]
  and r8d, 0xffffbfff
  mov r9d, dword ptr [rbx + 1276]
  mov rcx, rsi
  mov edx, 0x4b1
  call qword ptr [rbx + 1248]
  test eax, eax
  jnz apply_ok
  call qword ptr [rbx + 1264]
  mov dword ptr [rbx + 1292], eax
  cmp eax, 1409
  je apply_conflict
  mov dword ptr [rbx + 1288], 3
  jmp apply_finish
apply_conflict:
  mov dword ptr [rbx + 1288], 2
  jmp apply_finish
apply_ok:
  mov dword ptr [rbx + 1292], 0
  mov dword ptr [rbx + 1288], 1
apply_finish:
  mov eax, dword ptr [rbx + 1280]
  mov dword ptr [rbx + 1284], eax
  add rsp, 40
  pop rsi
  pop rbx
  ret

.align 8
hook_data:
.globl d_next
d_next:
  .quad 0
.globl d_callwnd
d_callwnd:
  .quad 0
.globl d_show
d_show:
  .quad 0
.globl d_foreground
d_foreground:
  .quad 0
.globl d_gettext
d_gettext:
  .quad 0
.globl d_setlong
d_setlong:
  .quad 0
.globl d_fore
d_fore:
  .quad 0
.globl d_post
d_post:
  .quad 0
.globl d_notify
d_notify:
  .quad 0
.globl d_menu
d_menu:
  .quad 0
.globl d_append
d_append:
  .quad 0
.globl d_track
d_track:
  .quad 0
.globl d_destroy
d_destroy:
  .quad 0
.globl d_cursor
d_cursor:
  .quad 0
.globl d_hook
d_hook:
  .quad 0
.globl d_old
d_old:
  .quad 0
.globl d_hwnd
d_hwnd:
  .quad 0
.globl d_enabled
d_enabled:
  .long 0
.globl d_force
d_force:
  .long 0
.globl d_hidden
d_hidden:
  .long 0
.globl d_sub
d_sub:
  .long 0
.globl d_added
d_added:
  .long 0
  .long 0
.globl d_expect
d_expect:
  .short 0x0050, 0x0072, 0x006f, 0x006d, 0x0070, 0x0074, 0x0044, 0x0065, 0x0063, 0x006b, 0x0000
  .short 0
.globl d_title
d_title:
  .zero 64
.globl d_show_text
d_show_text:
  .short 0x663e, 0x793a, 0x0000
  .short 0
.globl d_quit_text
d_quit_text:
  .short 0x9000, 0x51fa, 0x0000
  .short 0
.globl d_point
d_point:
  .long 0, 0
.globl d_nid
d_nid:
  .zero 976
.globl d_reghot
d_reghot:
  .quad 0
.globl d_unreghot
d_unreghot:
  .quad 0
.globl d_lasterr
d_lasterr:
  .quad 0
.globl d_hk_mods
d_hk_mods:
  .long 0
.globl d_hk_vk
d_hk_vk:
  .long 0
.globl d_hk_seq
d_hk_seq:
  .long 0
.globl d_hk_done
d_hk_done:
  .long 0
.globl d_hk_result
d_hk_result:
  .long 0
.globl d_hk_error
d_hk_error:
  .long 0
