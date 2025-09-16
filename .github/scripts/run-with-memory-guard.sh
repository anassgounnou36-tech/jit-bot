#!/bin/bash

# Memory Guard Wrapper for JIT Bot
# Monitors RSS memory usage and terminates the bot process gracefully when threshold is exceeded
# Usage: ./run-with-memory-guard.sh <memory_limit_mb> <command> [args...]

set -euo pipefail

# Configuration
MEMORY_LIMIT_MB="${1:-5600}"
shift
COMMAND="$@"

# Guard configuration  
CHECK_INTERVAL_SECONDS=5
LOG_PREFIX="🛡️  [MEMORY-GUARD]"

echo "$LOG_PREFIX Starting memory guard with ${MEMORY_LIMIT_MB}MB limit"
echo "$LOG_PREFIX Command: $COMMAND"
echo "$LOG_PREFIX Check interval: ${CHECK_INTERVAL_SECONDS}s"
echo ""

# Start the bot process in the background
echo "$LOG_PREFIX Starting bot process..."
$COMMAND &
BOT_PID=$!

echo "$LOG_PREFIX Bot started with PID: $BOT_PID"
echo "$LOG_PREFIX Monitoring memory usage..."

# Function to get RSS memory in MB for a process
get_rss_mb() {
    local pid=$1
    if [ -f "/proc/$pid/status" ]; then
        # Extract VmRSS from /proc/PID/status (in kB) and convert to MB
        local rss_kb=$(grep "^VmRSS:" "/proc/$pid/status" 2>/dev/null | awk '{print $2}' || echo "0")
        echo $((rss_kb / 1024))
    else
        echo "0"
    fi
}

# Function to get total memory usage including child processes
get_total_rss_mb() {
    local parent_pid=$1
    local total_rss=0
    
    # Get memory for parent process
    local parent_rss=$(get_rss_mb $parent_pid)
    total_rss=$((total_rss + parent_rss))
    
    # Get memory for all child processes
    if [ -d "/proc/$parent_pid" ]; then
        # Find all child processes
        local children=$(pgrep -P $parent_pid 2>/dev/null || true)
        for child_pid in $children; do
            local child_rss=$(get_rss_mb $child_pid)
            total_rss=$((total_rss + child_rss))
            
            # Recursively check grandchildren
            local grandchildren=$(pgrep -P $child_pid 2>/dev/null || true)
            for grandchild_pid in $grandchildren; do
                local grandchild_rss=$(get_rss_mb $grandchild_pid)
                total_rss=$((total_rss + grandchild_rss))
            done
        done
    fi
    
    echo $total_rss
}

# Function for graceful shutdown
graceful_shutdown() {
    local reason="$1"
    echo ""
    echo "$LOG_PREFIX $reason"
    echo "$LOG_PREFIX Initiating graceful shutdown..."
    
    # Send SIGTERM to allow graceful shutdown
    if kill -0 $BOT_PID 2>/dev/null; then
        echo "$LOG_PREFIX Sending SIGTERM to bot process (PID: $BOT_PID)..."
        kill -TERM $BOT_PID
        
        # Wait up to 30 seconds for graceful shutdown
        local waited=0
        while [ $waited -lt 30 ] && kill -0 $BOT_PID 2>/dev/null; do
            sleep 1
            waited=$((waited + 1))
            if [ $((waited % 5)) -eq 0 ]; then
                echo "$LOG_PREFIX Waiting for graceful shutdown... (${waited}s)"
            fi
        done
        
        # Force kill if still running
        if kill -0 $BOT_PID 2>/dev/null; then
            echo "$LOG_PREFIX Process didn't exit gracefully, sending SIGKILL..."
            kill -KILL $BOT_PID 2>/dev/null || true
            echo "$LOG_PREFIX Process forcefully terminated"
        else
            echo "$LOG_PREFIX Process exited gracefully"
        fi
    else
        echo "$LOG_PREFIX Process already exited"
    fi
}

# Set up signal handlers for clean shutdown
trap 'graceful_shutdown "Received interrupt signal"' INT TERM

# Memory monitoring loop
memory_exceeded_count=0
last_memory_report=0

while kill -0 $BOT_PID 2>/dev/null; do
    current_rss_mb=$(get_total_rss_mb $BOT_PID)
    current_time=$(date +%s)
    
    # Report memory usage every 60 seconds or on first check
    if [ $((current_time - last_memory_report)) -ge 60 ] || [ $last_memory_report -eq 0 ]; then
        echo "$LOG_PREFIX Memory usage: ${current_rss_mb}MB / ${MEMORY_LIMIT_MB}MB ($(date))"
        last_memory_report=$current_time
    fi
    
    # Check if memory limit exceeded
    if [ $current_rss_mb -gt $MEMORY_LIMIT_MB ]; then
        memory_exceeded_count=$((memory_exceeded_count + 1))
        echo "$LOG_PREFIX ⚠️  Memory limit exceeded: ${current_rss_mb}MB > ${MEMORY_LIMIT_MB}MB (count: $memory_exceeded_count)"
        
        # Terminate if exceeded for 2 consecutive checks (10 seconds)
        if [ $memory_exceeded_count -ge 2 ]; then
            graceful_shutdown "Memory limit exceeded multiple times - terminating to prevent OOM"
            exit 0
        fi
    else
        # Reset counter if memory is back under limit
        if [ $memory_exceeded_count -gt 0 ]; then
            echo "$LOG_PREFIX Memory usage back under limit: ${current_rss_mb}MB"
            memory_exceeded_count=0
        fi
    fi
    
    sleep $CHECK_INTERVAL_SECONDS
done

# Wait for the bot process to complete and capture its exit code
wait $BOT_PID
BOT_EXIT_CODE=$?

echo ""
echo "$LOG_PREFIX Bot process completed with exit code: $BOT_EXIT_CODE"

# Final memory report
final_rss_mb=$(get_total_rss_mb $BOT_PID 2>/dev/null || echo "0")
echo "$LOG_PREFIX Final memory usage: ${final_rss_mb}MB"
echo "$LOG_PREFIX Memory guard finished"

exit $BOT_EXIT_CODE