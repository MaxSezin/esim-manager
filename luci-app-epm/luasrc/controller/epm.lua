-- /usr/lib/lua/luci/controller/epm.lua
module("luci.controller.epm", package.seeall)

local json = require "luci.jsonc"
local sys = require "luci.sys"
local util = require "luci.util"
local uci = require "luci.model.uci".cursor()

function index()
    -- Five real pages (sibling menu entries under admin/modem/epm), not one
    -- page with client-side tab-switching: the theme renders the tab bar
    -- between sibling pages entirely on its own (same mechanism the
    -- vendor's own "5G Modem" pages use), so active/inactive tab styling
    -- comes from the theme automatically instead of being hand-rolled.
    -- Page paths use a "tab-" prefix specifically so they can't collide
    -- with the JSON API leaf entries below (e.g. .../epm/profiles is
    -- already the profile-list API endpoint, so the Profiles *page* lives
    -- at .../epm/tab-profiles instead).
    entry({"admin", "modem", "epm"}, alias("admin", "modem", "epm", "tab-info"), _("eSIM Manager"), 60)
    entry({"admin", "modem", "epm", "tab-info"}, view("epm/info"), _("eSIM Info"), 10)
    entry({"admin", "modem", "epm", "tab-profiles"}, view("epm/profiles"), _("Profiles"), 20)
    entry({"admin", "modem", "epm", "tab-download"}, view("epm/download"), _("Download Profile"), 30)
    entry({"admin", "modem", "epm", "tab-notifications"}, view("epm/notifications"), _("Notifications"), 40)
    entry({"admin", "modem", "epm", "tab-config"}, view("epm/config"), _("Configuration"), 50)

    entry({"admin", "modem", "epm", "status"}, call("epm_status"), nil).leaf = true
    entry({"admin", "modem", "epm", "profiles"}, call("epm_profiles"), nil).leaf = true
    entry({"admin", "modem", "epm", "toggle"}, call("epm_toggle"), nil).leaf = true
    entry({"admin", "modem", "epm", "config"}, call("epm_config"), nil).leaf = true
    entry({"admin", "modem", "epm", "saveconfig"}, call("epm_save_config"), nil).leaf = true
    entry({"admin", "modem", "epm", "download"}, call("epm_download_profile"), nil).leaf = true
    entry({"admin", "modem", "epm", "delete"}, call("epm_delete_profile"), nil).leaf = true
    entry({"admin", "modem", "epm", "nickname"}, call("epm_change_nickname"), nil).leaf = true
    entry({"admin", "modem", "epm", "notifications"}, call("epm_notifications"), nil).leaf = true
    entry({"admin", "modem", "epm", "notification_process"}, call("epm_notification_process"), nil).leaf = true
    entry({"admin", "modem", "epm", "notification_remove"}, call("epm_notification_remove"), nil).leaf = true
    entry({"admin", "modem", "epm", "notification_process_all"}, call("epm_notification_process_all"), nil).leaf = true
    entry({"admin", "modem", "epm", "notification_process_and_remove_all"}, call("epm_notification_process_and_remove_all"), nil).leaf = true
    entry({"admin", "modem", "epm", "notification_remove_all"}, call("epm_notification_remove_all"), nil).leaf = true
    entry({"admin", "modem", "epm", "connectivity"}, call("epm_connectivity_check"), nil).leaf = true
    entry({"admin", "modem", "epm", "reboot_status"}, call("reboot_status"), nil)
    entry({"admin", "modem", "epm", "reboot_modem"}, call("reboot_modem"), nil)
end

-- Build env for LPAC command
function build_lpac_env()
    local env_vars = {}
    local config = {}

    -- Read epm configuaration from UCI 
    uci:foreach("epm", "epm", function(s)
        config = s
    end)

    -- Use defaults, if configuration is not present in UCI
    if not config or not next(config) then
        config = {
            apdu_backend = 'at',
            http_backend = 'curl',
            at_device = '/dev/ttyUSB3',
            qmi_device = '/dev/cdc-wdm0',
            qmi_sim_slot = '1',
            mbim_device = '/dev/cdc-wdm0',
            mbim_proxy = '0',
            mbim_sim_slot = '1',
            tls_gnutls_preload = '0',
            tls_gnutls_preload_path = '/usr/lib/libcurl-gnutls.so.4',
            apdu_debug = '0',
            http_debug = '0',
            at_debug = '0',
            reboot_method = 'at',
            reboot_at_command = 'AT+CFUN=1,1',
            reboot_at_device = '/dev/ttyUSB3',
            reboot_qmi_device = '/dev/cdc-wdm0',
            reboot_qmi_slot = '1',
            reboot_mbim_device = '/dev/cdc-wdm0',
            reboot_custom_command = 'echo "Custom reboot command here"',
            json_output = '0'
        }
    end

    if config.apdu_backend then
        table.insert(env_vars, "LPAC_APDU=" .. config.apdu_backend)
    end

    if config.http_backend then
        table.insert(env_vars, "LPAC_HTTP=" .. config.http_backend)
    end

    if config.at_device then
        table.insert(env_vars, "AT_DEVICE=" .. config.at_device)
    end

    if config.qmi_device then
        table.insert(env_vars, "LPAC_QMI_DEV=" .. config.qmi_device)
    end

    if config.mbim_device then
        table.insert(env_vars, "MBIM_DEVICE=" .. config.mbim_device)
    end

    if config.mbim_proxy then
        table.insert(env_vars, "MBIM_USE_PROXY=" .. config.mbim_proxy)
    end

    if config.mbim_sim_slot then
        table.insert(env_vars, "LPAC_APDU_MBIM_UIM_SLOT=" .. config.mbim_sim_slot)
    end

    if config.apdu_debug and config.apdu_debug ~= '0' then
        table.insert(env_vars, "LIBEUICC_DEBUG_APDU=1")
    end

    if config.http_debug and config.http_debug ~= '0' then
        table.insert(env_vars, "LIBEUICC_DEBUG_HTTP=1")
    end

    if config.at_debug and config.at_debug ~= '0' then
        table.insert(env_vars, "AT_DEBUG=1")
    end

    -- Optional TLS workaround: preload a GnuTLS-backed libcurl for lpac's
    -- HTTP backend, needed when the system libcurl (mbedTLS) can't validate
    -- the SM-DP+ server's root CA (GSMA RSP2 Root CI1).
    if config.tls_gnutls_preload and config.tls_gnutls_preload ~= '0' then
        local preload_path = config.tls_gnutls_preload_path
        if preload_path and preload_path ~= '' then
            local f = io.open(preload_path, "r")
            if f then
                f:close()
                table.insert(env_vars, 1, "LD_PRELOAD=" .. preload_path)
            end
        end
    end

    return table.concat(env_vars, " ")
end

-- Resolve the lpac binary path. Some builds (e.g. the community lpac-build
-- packages) install it as /usr/lib/lpac/lpac plus driver plugins under
-- /usr/lib/lpac/driver (needs LPAC_DRIVER_HOME, since OpenWrt strips
-- RUNPATH); the plain official OpenWrt lpac package installs it as a single
-- file directly at /usr/lib/lpac. Support both so switching between the two
-- doesn't require editing this path by hand.
local function resolve_lpac_bin()
    local f = io.open("/usr/lib/lpac/lpac", "r")
    if f then
        f:close()
        -- LPAC_DRIVER_HOME must sit BEFORE "timeout" in the final command
        -- line: shell only treats a bare VAR=value token as an environment
        -- assignment when it appears before the first command word. Placed
        -- after "timeout N" it would instead be parsed as timeout's own
        -- command argument (i.e. "run a program literally named
        -- LPAC_DRIVER_HOME=/usr/lib/lpac"), which fails immediately.
        return "/usr/lib/lpac/lpac", "LPAC_DRIVER_HOME=/usr/lib/lpac "
    end
    return "/usr/lib/lpac", ""
end

-- Run lpac command with env build from configuration, adding timeout to avoid commands hang
function exec_lpac_command(cmd_args, timeout_seconds)
    local env = build_lpac_env()
    local timeout = timeout_seconds or 30
    local lpac_bin, driver_home_env = resolve_lpac_bin()
    local full_cmd = driver_home_env .. env .. " timeout " .. timeout .. " " .. lpac_bin .. " " .. cmd_args

    -- Debug
    -- full_cmd already contains shellquote()'d arguments wrapped in single
    -- quotes; nesting it inside another pair of single quotes here would
    -- break out of those quotes and let the shell re-expand $ inside them
    -- (e.g. activation codes like LPA:1$smdp$matchingid). Quote the whole
    -- log message as one argument instead.
    luci.sys.exec("logger -t epm " .. util.shellquote("Executing: " .. full_cmd))
    
    local result = sys.exec(full_cmd)
    local exit_code = os.execute(full_cmd .. " >/dev/null 2>&1")
    
    if exit_code == 124 then 
        luci.sys.exec("logger -t epm 'LPAC command timed out after " .. timeout .. " seconds'")
        return nil, "Command timed out"
    end
    
    return result
end

-- Parse lpac's (possibly multi-line) JSON output. lpac prints one JSON object
-- per line for each step of a multi-step operation (e.g. a profile download
-- goes through es9p_initiate_authentication, es9p_authenticate_client,
-- es9p_get_bound_profile_package, ... before the final "lpa" result) - only
-- the LAST "lpa"-type line was ever surfaced to the frontend, so a failure
-- partway through looked identical to "nothing happened" with no indication
-- of which step it died on. Returns the final result (unchanged behavior for
-- existing callers) plus the full ordered list of every step found, so
-- callers can attach it to their response for the frontend to show as a log.
local function parse_lpac_output(raw_output)
    if not raw_output or raw_output == "" then
        return nil, {}
    end

    local lines = {}
    for line in raw_output:gmatch("[^\r\n]+") do
        if line:match("^%s*{.*}%s*$") then
            table.insert(lines, line:match("^%s*(.-)%s*$"))
        end
    end

    local final_result = nil
    local steps = {}
    for _, line in ipairs(lines) do
        local success, json_obj = pcall(function()
            return luci.jsonc.parse(line)
        end)

        if success and json_obj then
            table.insert(steps, json_obj)
            if json_obj.type == "lpa" and json_obj.payload then
                final_result = json_obj
            end
        end
    end

    return final_result, steps
end

function epm_connectivity_check()
    local cmd = "ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1"
    local result = os.execute(cmd)
    local connected = (result == 0)

    luci.http.prepare_content("application/json")
    luci.http.write_json({
        success = true,
        connected = connected,
        message = connected and "Internet connection available" or "No internet connection detected"
    })
end

function epm_status()
    local result, error_msg = exec_lpac_command("chip info", 5)  -- 5s for "lpac chip info"

    if not result then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = error_msg or "Failed to execute lpac command"
        })
        return
    end

    if result then
        local data = json.parse(result)
        if data and data.type == "lpa" and data.payload and data.payload.code == 0 then
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = true,
                eid = data.payload.data.eidValue,
                info = data.payload.data.EUICCInfo2,
                addresses = data.payload.data.EuiccConfiguredAddresses
            })
        else
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = false,
                error = "Failed to parse eSIM info"
            })
        end
    end
end

function epm_profiles()
    local result, error_msg = exec_lpac_command("profile list", 20)  -- 20s for "lpac profile list"

    if not result then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = error_msg or "Failed to execute lpac command"
        })
        return
    end

    if result then
        local data = json.parse(result)
        if data and data.type == "lpa" and data.payload and data.payload.code == 0 then
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = true,
                profiles = data.payload.data or {}
            })
        else
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = false,
                error = "Failed to parse profile list"
            })
        end
    end
end

function epm_toggle()
    local iccid = luci.http.formvalue("iccid")
    local action = luci.http.formvalue("action")

    if not iccid or not action then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Missing iccid or action parameter"
        })
        return
    end

    if action ~= "enable" and action ~= "disable" then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Invalid action. Use 'enable' or 'disable'"
        })
        return
    end

    local cmd_args = string.format("profile %s %s", action, util.shellquote(iccid))
    local result = exec_lpac_command(cmd_args, 30)

    if result then
        local data = json.parse(result)
        if data and data.type == "lpa" and data.payload and data.payload.code == 0 then
            local reboot_flag_file = "/tmp/epm_reboot_needed"
            local reason_file = "/tmp/epm_reboot_reason"

            luci.sys.exec("touch " .. reboot_flag_file)
            luci.sys.exec("echo 'Profile enabled - restart required' > " .. reason_file)
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = true,
                message = string.format("Profile %s %sd successfully", iccid, action)
            })
        else
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = false,
                error = data and data.payload and data.payload.message or "Command failed"
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Failed to execute lpac command"
        })
    end
end

function epm_config()
    local config = {}

    -- Read epm configuaration from UCI 
    uci:foreach("epm", "epm", function(s)
        config.epm = s
    end)

    -- Use defaults, if configuration is not present in UCI
    if not config.epm then
        config.epm = {
            apdu_backend = 'at',
            http_backend = 'curl',
            at_device = '/dev/ttyUSB3',
            qmi_device = '/dev/cdc-wdm0',
            qmi_sim_slot = '1',
            mbim_device = '/dev/cdc-wdm0',
            mbim_proxy = '0',
            mbim_sim_slot = '1',
            tls_gnutls_preload = '0',
            tls_gnutls_preload_path = '/usr/lib/libcurl-gnutls.so.4',
            apdu_debug = '0',
            http_debug = '0',
            at_debug = '0',
            reboot_method = 'at',
            reboot_at_command = 'AT+CFUN=1,1',
            reboot_qmi_device = '/dev/cdc-wdm0',
            reboot_qmi_slot = '1',
            reboot_mbim_device = '/dev/cdc-wdm0',
            reboot_custom_command = 'echo "Custom reboot command here"',
            json_output = '0'
        }
    end

    luci.http.prepare_content("application/json")
    luci.http.write_json({
        success = true,
        config = config
    })
end

function epm_save_config()
    local config_data = luci.http.formvalue("config")

    if not config_data then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "No configuration data provided"
        })
        return
    end

    local config = json.parse(config_data)
    if not config then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Invalid JSON configuration"
        })
        return
    end

    if config.epm then
        uci:delete("epm", "epm")
        uci:section("epm", "epm", "epm", config.epm)
        local result = uci:commit("epm")

        if result then
            luci.http.prepare_content("application/json")
            luci.http.write_json({
               success = true,
               message = "Configuration saved successfully"
            })
        else
            luci.http.prepare_content("application/json")
            luci.http.write_json({
               success = false,
               error = "Failed to save configuration"
           })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
           success = false,
           error = "No EPM configuration provided"
       })
    end
end

function epm_download_profile()
    local smdp_server_address = luci.http.formvalue("smdp_server_address")
    local activation_code = luci.http.formvalue("activation_code")
    local qr_activation_code = luci.http.formvalue("qr_activation_code")
    local confirmation_code = luci.http.formvalue("confirmation_code")

    local has_qr = qr_activation_code and qr_activation_code ~= ""
    local has_smdp_pair = smdp_server_address and smdp_server_address ~= "" and 
                          activation_code and activation_code ~= ""
    
    local cmd_args = ""

    if not has_qr and not has_smdp_pair then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            type = "error",
            payload = {
                code = -1,
                message = "validation_error",
                data = "QR activation code OR SM-DP+ server address with activation code are required"
            }
        })
        return
    end

    if has_qr then
        cmd_args = "profile download -a " .. util.shellquote(qr_activation_code)
    end

    if has_smdp_pair then
        cmd_args = "profile download -s " .. util.shellquote(smdp_server_address) .. " -m " .. util.shellquote(activation_code)
    end

    if confirmation_code and confirmation_code ~= "" then
        cmd_args = cmd_args .. " -c " .. util.shellquote(confirmation_code)
    end

    local result, error_msg = exec_lpac_command(cmd_args, 90)

    if result then
        local final_result, lpac_steps = parse_lpac_output(result)

        luci.http.prepare_content("application/json")

        if final_result and final_result.payload then
            -- Build fresh tables rather than reusing final_result.payload
            -- directly: it's the SAME table as the last entry of
            -- lpac_steps (both came from parsing the same line), and
            -- luci.jsonc.stringify appears to track already-serialized
            -- tables by identity and emit null the second time it meets
            -- one - even here, where the two references aren't actually a
            -- cycle, just two branches pointing at the same table.
            luci.http.write_json({
                type = final_result.type,
                payload = {
                    code = final_result.payload.code,
                    message = final_result.payload.message,
                    data = final_result.payload.data
                },
                steps = lpac_steps
            })
        else
            luci.http.write_json({
                type = "error",
                payload = {
                    code = -1,
                    message = "execution_error",
                    data = "No LPA result found in command output"
                },
                steps = lpac_steps
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            type = "error",
            payload = {
                code = -1,
                message = "command_failed",
                data = error_msg or "Failed to execute lpac command"
            }
        })
    end
end

function epm_delete_profile()
    local iccid = luci.http.formvalue("iccid")

    if not iccid or iccid == "" then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "ICCID is required"
        })
        return
    end

    local cmd_args = "profile delete " .. util.shellquote(iccid)
    local result = exec_lpac_command(cmd_args, 30)

    if result then
        local data = json.parse(result)
        if data and data.type == "lpa" and data.payload and data.payload.code == 0 then
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = true,
                message = "Profile deleted successfully"
            })
        else
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = false,
                error = data and data.payload and data.payload.message or "Delete failed"
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Failed to execute lpac command"
        })
    end
end

function epm_change_nickname()
    local iccid = luci.http.formvalue("iccid")
    local nickname = luci.http.formvalue("nickname")

    if not iccid or iccid == "" then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "ICCID is required"
        })
        return
    end

    if not nickname or nickname == "" then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Nickname is required"
        })
        return
    end

    local cmd_args = "profile nickname " .. util.shellquote(iccid) .. " " .. util.shellquote(nickname)
    local result = exec_lpac_command(cmd_args, 30)

    if result then
        local data = json.parse(result)
        if data and data.type == "lpa" and data.payload and data.payload.code == 0 then
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = true,
                message = "Profile nickname changed successfully"
            })
        else
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = false,
                error = data and data.payload and data.payload.message or "Nickname change failed"
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Failed to execute lpac command"
        })
    end
end

function epm_notifications()
    local result = exec_lpac_command("notification list", 30)

    if result then
        local data = json.parse(result)
        if data and data.type == "lpa" and data.payload and data.payload.code == 0 then
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = true,
                notifications = data.payload.data or {}
            })
        else
            luci.http.prepare_content("application/json")
            luci.http.write_json({
                success = false,
                error = "Failed to parse notification list"
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Failed to execute lpac command"
        })
    end
end

function epm_notification_process()
    local seqNumber = luci.http.formvalue("seqNumber")

    if not seqNumber or seqNumber == "" then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Sequence number is required"
        })
        return
    end

    local cmd_args = "notification process " .. util.shellquote(seqNumber)
    local result = exec_lpac_command(cmd_args, 30)

    if result then
        local final_result, lpac_steps = parse_lpac_output(result)

        luci.http.prepare_content("application/json")

        if final_result and final_result.payload then
            -- Build fresh tables rather than reusing final_result.payload
            -- directly: it's the SAME table as the last entry of
            -- lpac_steps (both came from parsing the same line), and
            -- luci.jsonc.stringify appears to track already-serialized
            -- tables by identity and emit null the second time it meets
            -- one - even here, where the two references aren't actually a
            -- cycle, just two branches pointing at the same table.
            luci.http.write_json({
                type = final_result.type,
                payload = {
                    code = final_result.payload.code,
                    message = final_result.payload.message,
                    data = final_result.payload.data
                },
                steps = lpac_steps
            })
        else
            luci.http.write_json({
                type = "error",
                payload = {
                    code = -1,
                    message = "execution_error",
                    data = "No LPA result found in command output"
                },
                steps = lpac_steps
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            type = "error",
            payload = {
                code = -1,
                message = "command_failed",
                data = error_msg or "Failed to execute lpac command"
            }
        })
    end
end

function epm_notification_remove()
    local seqNumber = luci.http.formvalue("seqNumber")

    if not seqNumber or seqNumber == "" then
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            success = false,
            error = "Sequence number is required"
        })
        return
    end

    local cmd_args = "notification remove " .. util.shellquote(seqNumber)
    local result = exec_lpac_command(cmd_args, 30)

    if result then
        local final_result, lpac_steps = parse_lpac_output(result)

        luci.http.prepare_content("application/json")

        if final_result and final_result.payload then
            -- Build fresh tables rather than reusing final_result.payload
            -- directly: it's the SAME table as the last entry of
            -- lpac_steps (both came from parsing the same line), and
            -- luci.jsonc.stringify appears to track already-serialized
            -- tables by identity and emit null the second time it meets
            -- one - even here, where the two references aren't actually a
            -- cycle, just two branches pointing at the same table.
            luci.http.write_json({
                type = final_result.type,
                payload = {
                    code = final_result.payload.code,
                    message = final_result.payload.message,
                    data = final_result.payload.data
                },
                steps = lpac_steps
            })
        else
            luci.http.write_json({
                type = "error",
                payload = {
                    code = -1,
                    message = "execution_error",
                    data = "No LPA result found in command output"
                },
                steps = lpac_steps
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            type = "error",
            payload = {
                code = -1,
                message = "command_failed",
                data = error_msg or "Failed to execute lpac command"
            }
        })
    end
end

function epm_notification_process_all()
    local result = exec_lpac_command("notification process -a", 30)

    if result then
        local final_result, lpac_steps = parse_lpac_output(result)

        luci.http.prepare_content("application/json")

        if final_result and final_result.payload then
            -- Build fresh tables rather than reusing final_result.payload
            -- directly: it's the SAME table as the last entry of
            -- lpac_steps (both came from parsing the same line), and
            -- luci.jsonc.stringify appears to track already-serialized
            -- tables by identity and emit null the second time it meets
            -- one - even here, where the two references aren't actually a
            -- cycle, just two branches pointing at the same table.
            luci.http.write_json({
                type = final_result.type,
                payload = {
                    code = final_result.payload.code,
                    message = final_result.payload.message,
                    data = final_result.payload.data
                },
                steps = lpac_steps
            })
        else
            luci.http.write_json({
                type = "error",
                payload = {
                    code = -1,
                    message = "execution_error",
                    data = "No LPA result found in command output"
                },
                steps = lpac_steps
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            type = "error",
            payload = {
                code = -1,
                message = "command_failed",
                data = error_msg or "Failed to execute lpac command"
            }
        })
    end
end

function epm_notification_process_and_remove_all()
    local result = exec_lpac_command("notification process -a -r", 30)

    if result then
        local final_result, lpac_steps = parse_lpac_output(result)

        luci.http.prepare_content("application/json")

        if final_result and final_result.payload then
            -- Build fresh tables rather than reusing final_result.payload
            -- directly: it's the SAME table as the last entry of
            -- lpac_steps (both came from parsing the same line), and
            -- luci.jsonc.stringify appears to track already-serialized
            -- tables by identity and emit null the second time it meets
            -- one - even here, where the two references aren't actually a
            -- cycle, just two branches pointing at the same table.
            luci.http.write_json({
                type = final_result.type,
                payload = {
                    code = final_result.payload.code,
                    message = final_result.payload.message,
                    data = final_result.payload.data
                },
                steps = lpac_steps
            })
        else
            luci.http.write_json({
                type = "error",
                payload = {
                    code = -1,
                    message = "execution_error",
                    data = "No LPA result found in command output"
                },
                steps = lpac_steps
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            type = "error",
            payload = {
                code = -1,
                message = "command_failed",
                data = error_msg or "Failed to execute lpac command"
            }
        })
    end
end

function epm_notification_remove_all()
    local result = exec_lpac_command("notification remove -a", 30)

    if result then
        local final_result, lpac_steps = parse_lpac_output(result)

        luci.http.prepare_content("application/json")

        if final_result and final_result.payload then
            -- Build fresh tables rather than reusing final_result.payload
            -- directly: it's the SAME table as the last entry of
            -- lpac_steps (both came from parsing the same line), and
            -- luci.jsonc.stringify appears to track already-serialized
            -- tables by identity and emit null the second time it meets
            -- one - even here, where the two references aren't actually a
            -- cycle, just two branches pointing at the same table.
            luci.http.write_json({
                type = final_result.type,
                payload = {
                    code = final_result.payload.code,
                    message = final_result.payload.message,
                    data = final_result.payload.data
                },
                steps = lpac_steps
            })
        else
            luci.http.write_json({
                type = "error",
                payload = {
                    code = -1,
                    message = "execution_error",
                    data = "No LPA result found in command output"
                },
                steps = lpac_steps
            })
        end
    else
        luci.http.prepare_content("application/json")
        luci.http.write_json({
            type = "error",
            payload = {
                code = -1,
                message = "command_failed",
                data = error_msg or "Failed to execute lpac command"
            }
        })
    end
end

function reboot_status()
    luci.http.prepare_content("application/json")

    local result = {
        success = false,
        reboot_needed = false,
        reason = "",
        error = ""
    }

    if luci.http.getenv("REQUEST_METHOD") ~= "GET" then
        result.error = "Method not allowed"
        luci.http.write(json.encode(result))
        return
    end

    local reboot_flag_file = "/tmp/epm_reboot_needed"
    local reason_file = "/tmp/epm_reboot_reason"

    local flag_exists = luci.sys.exec("test -f " .. reboot_flag_file .. " && echo 'yes' || echo 'no'"):match("yes")

    if flag_exists then
        result.success = true
        result.reboot_needed = true

        local reason_exists = luci.sys.exec("test -f " .. reason_file .. " && echo 'yes' || echo 'no'"):match("yes")
        if reason_exists then
            local reason_content = luci.sys.exec("cat " .. reason_file .. " 2>/dev/null"):gsub("\n", "")
            if reason_content and reason_content ~= "" then
                result.reason = reason_content
            else
                result.reason = "Profile changes require a modem restart to take effect."
            end
        else
            result.reason = "Profile changes require a modem restart to take effect."
        end
    else
        result.success = true
        result.reboot_needed = false
    end

    luci.http.write(json.stringify(result))
end

function reboot_modem()
    luci.http.prepare_content("application/json")

    local result = {
        success = false,
        message = "",
        error = ""
    }

    if luci.http.getenv("REQUEST_METHOD") ~= "POST" then
        result.error = "Method not allowed"
        luci.http.write(json.encode(result))
        return
    end

    luci.sys.exec("logger -t epm 'Modem reboot requested via eSIM Manager'")

    local reboot_flag_file = "/tmp/epm_reboot_needed"
    local reason_file = "/tmp/epm_reboot_reason"

    luci.sys.exec("rm -f " .. reboot_flag_file .. " " .. reason_file)
    luci.sys.exec("logger -t epm 'Reboot flags cleared before restart'")

    local config = {}
    uci:foreach("epm", "epm", function(s)
        config = s
    end)

    if not config or not config.reboot_method then
        config.reboot_method = 'at'
        config.apdu_backend = 'at'
        config.at_device = '/dev/ttyUSB3'
        config.qmi_device = '/dev/cdc-wdm0'
        config.qmi_sim_slot = '1'
        config.mbim_device = '/dev/cdc-wdm0'
        config.reboot_at_command = 'AT+CFUN=1,1'
        config.reboot_at_device = '/dev/ttyUSB3'
        config.reboot_qmi_device = '/dev/cdc-wdm0'
        config.reboot_qmi_slot = '1'
        config.reboot_mbim_device = '/dev/cdc-wdm0'
        config.reboot_custom_command = 'echo "Custom reboot command here"'
    end

    local reboot_cmd = ""
    local method_used = ""
    
    if config.reboot_method == 'at' then
        -- AT method
        local at_device = config.reboot_at_device or '/dev/ttyUSB3'
        local at_command = config.reboot_at_command or 'AT+CFUN=1,1'
        reboot_cmd = string.format("printf '%s\\r\\n' > %s", at_command, at_device)
        method_used = "AT"
        luci.sys.exec("logger -t epm 'Using AT reboot method: " .. at_command .. " on " .. at_device .. "'")
        
    elseif config.reboot_method == 'qmi' then
        -- QMI method
        local qmi_device = config.reboot_qmi_device or config.qmi_device or '/dev/cdc-wdm0'
        local qmi_slot = config.reboot_qmi_slot or config.qmi_sim_slot or '1'
        reboot_cmd = string.format("uqmi -d %s --uim-power-off --uim-slot=%s && sleep 2 && uqmi -d %s --uim-power-on --uim-slot=%s", 
                                 qmi_device, qmi_slot, qmi_device, qmi_slot)
        method_used = "QMI"
        luci.sys.exec("logger -t epm 'Using QMI reboot method on " .. qmi_device .. " slot " .. qmi_slot .. "'")
        
    elseif config.reboot_method == 'mbim' then
        -- MBIM method
        local mbim_device = config.reboot_mbim_device or config.mbim_device or '/dev/cdc-wdm0'
        reboot_cmd = string.format("mbimcli -d %s --ms-set-uicc-reset disable && sleep 2 %% mbimcli -d %s --set-radio-state=off && sleep 2 && mbimcli -d %s --set-radio-state=on", mbim_device, mbim_device, mbim_device)
        method_used = "MBIM"
        luci.sys.exec("logger -t epm 'Using MBIM reboot method on " .. mbim_device .. "'")
        
    elseif config.reboot_method == 'mmcli' then
        -- ModemManager reset. On some modems/firmware (seen on Foxconn T99W175 /
        -- Thales MV31-W) the eUICC/MBIM channel used for eSIM management can get
        -- stuck after a profile enable/disable (lpac calls start failing with
        -- "no channel response received" / "euicc_init"), and neither an AT
        -- CFUN cycle nor even a full router reboot clears it - the modem module
        -- doesn't lose power on a router reboot. `mmcli --reset` resets the
        -- modem's own radio firmware through ModemManager and does clear it.
        -- The modem's DBus index can change across resets, so resolve it fresh
        -- each time rather than hardcoding one.
        -- ModemManager can briefly show zero modems (e.g. up to ~30-40s right
        -- after the modemmanager service itself restarts) even while the
        -- modem is physically present and already working - a single mmcli
        -- -L would silently no-op in that window. Retry for up to ~10s.
        reboot_cmd = "MODEM=''; i=0; while [ $i -lt 5 ]; do " ..
            "MODEM=$(mmcli -L 2>/dev/null | grep -oE '/org/freedesktop/ModemManager1/Modem/[0-9]+' | head -1); " ..
            "[ -n \"$MODEM\" ] && break; i=$((i+1)); sleep 2; done; " ..
            "[ -n \"$MODEM\" ] && mmcli -m \"$MODEM\" --reset"
        method_used = "MMCLI"
        luci.sys.exec("logger -t epm 'Using MMCLI reset reboot method'")

    elseif config.reboot_method == 'custom' then
        -- Custom command method
        reboot_cmd = config.reboot_custom_command or 'echo "No custom command configured"'
        method_used = "Custom"
        luci.sys.exec("logger -t epm 'Using custom reboot method: " .. reboot_cmd .. "'")

    else
        -- Fallback to AT if unknown method
        local at_device = config.reboot_at_device or '/dev/ttyUSB3'
        reboot_cmd = string.format("printf 'AT+CFUN=1,1\\r\\n' > %s", at_device)
        method_used = "AT (fallback)"
        luci.sys.exec("logger -t epm 'Unknown reboot method, falling back to AT'")
    end

    local success = luci.sys.exec(reboot_cmd)

    if success then
        result.success = true
        result.message = string.format("Modem reboot initiated successfully using %s method", method_used)
        luci.sys.exec("logger -t epm 'Modem reboot command executed successfully using " .. method_used .. " method'")
    else
        result.error = "Failed to initiate modem reboot"
        luci.sys.exec("logger -t epm 'Modem reboot command failed'")
    end

    luci.http.write(json.stringify(result))
end