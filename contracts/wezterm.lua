local wezterm = require 'wezterm'
local mux = wezterm.mux

wezterm.on('gui-startup', function()
  
  local shell = os.getenv("SHELL") or "bash";
  local cwd = os.getenv("PWD");
  local current_dir=io.popen"cd":read'*l'
  if current_dir then
    cwd = string.gsub(string.gsub(current_dir, "C:\\", "/c/"), "\\", "/")
  end

  
  local tab, pane, window
  tab, pane, window = mux.spawn_window {
    cwd = current_dir,
    args = {'bash', '-i', '-c', 'cd ' .. cwd ..';' .. shell}
  }
  tab:set_title 'template-factory'
  window:set_title 'template-factory'
  
  -- local watch_deploy_pane = pane:split {
  --   args = {'bash', '-i', '-c', 'cd ' .. cwd ..'; sleep 1; pnpm watch_deploy; ' ..shell},
  --   direction = 'Bottom'
  -- }
  local watch_test_pane = pane:split {
    args = {'bash', '-i', '-c', 'cd ' .. cwd ..'; sleep 1; pnpm watch_test; ' ..shell},
    direction = 'Bottom'
  }

  local anvil_pane = watch_test_pane:split {
    args = {'bash', '-i', '-c', 'cd ' .. cwd ..'; anvil; ' ..shell},
    direction = 'Right'
  }

  -- local watch_compile_pane = watch_deploy_pane:split {
  --   --args = {'bash', '-i', '-c', 'sleep 1; pnpm watch_compile; bash'},
  --   args = {'bash', '-i', '-c', 'cd ' .. cwd ..'; sleep 1; pnpm watch_compile; ' ..shell},
  --   direction = 'Bottom'
  -- }

  
end)


config = {}

-- fix windows in virtualbox
config.prefer_egl=true

return config