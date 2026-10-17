option(GCD_SANITIZE "Enable AddressSanitizer and UndefinedBehaviorSanitizer" OFF)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang|AppleClang")
    target_compile_options(gc_tests PRIVATE -UNDEBUG)
    target_compile_options(interpreter_tests PRIVATE -UNDEBUG)
endif()

if(GCD_SANITIZE)
    get_property(GCD_EXISTING_TARGETS DIRECTORY PROPERTY BUILDSYSTEM_TARGETS)
    foreach(target IN LISTS GCD_EXISTING_TARGETS)
        target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
        target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endforeach()
endif()

function(gcd_v2_add_executable target source)
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/${source}")
        set(target_sources "${source}" ${CORE_SOURCES})
        if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/src/memory/diagnostics.cpp")
            list(APPEND target_sources src/memory/diagnostics.cpp)
        endif()

        add_executable(${target} ${target_sources})
        target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Werror)
        if(GCD_SANITIZE)
            target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
            target_link_options(${target} PRIVATE -fsanitize=address,undefined)
        endif()
    endif()
endfunction()

gcd_v2_add_executable(gcd_v2_canary tests/v2/canary_test.cpp)
if(TARGET gcd_v2_canary)
    add_test(
        NAME gcd_v2_canary
        COMMAND bash -c
                "\"$1\" >/dev/null 2>&1; status=$?; if [ \"$status\" -ne 0 ]; then exit 1; else exit 0; fi"
                bash "$<TARGET_FILE:gcd_v2_canary>")
    set_tests_properties(gcd_v2_canary PROPERTIES WILL_FAIL TRUE)
endif()

gcd_v2_add_executable(gc_correctness_tests tests/v2/gc_correctness_tests.cpp)
gcd_v2_add_executable(gc_property_tests tests/v2/gc_property_tests.cpp)
gcd_v2_add_executable(diagnostics_tests tests/v2/diagnostics_tests.cpp)
gcd_v2_add_executable(gcd_runner tools/gcd_runner/main.cpp)

if(TARGET gcd_runner AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/tests/v2/runner_tests.sh")
    add_test(
        NAME runner_tests
        COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/tests/v2/runner_tests.sh"
                "$<TARGET_FILE:gcd_runner>" "$<TARGET_FILE:garbage_cd>")
endif()
